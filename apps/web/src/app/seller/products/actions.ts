'use server';
import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import {
  EXTENSION_BY_TYPE, IMAGE_TYPES, MAX_PRODUCT_IMAGE_BYTES, MAX_VARIANTS_PER_PRODUCT, MIME_BY_TYPE, SELLER_PRODUCT_ACTIONS,
  addVariantSchema, createProductSchema, generateVariantCombinations, nairaToKobo, parseAttributesText, parseOptionsText,
  productUpdateSchema, stockAdjustSchema, updateVariantSchema, uuidSchema, type StoreProfile,
} from '@onwa/shared';
import { ApiError, apiRequest } from '@/lib/api';
import { intField, str } from '@/lib/forms';
import { firstIssueField } from '@/lib/messages';
import { requireSession } from '@/lib/session';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { checkUpload } from '@/lib/uploads';

const NEW_PATH = '/seller/products/new';
const productPath = (id: string) => `/seller/products/${id}`;

/** Maps an API failure to a message code the page can show. */
function codeFor(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 403) return 'forbidden_action';
    if (e.status === 404) return 'not_found';
    if (e.status === 409) return /insufficient stock/i.test(e.message) ? 'insufficient_stock' : 'conflict_action';
    if (e.status === 400) return /incomplete/i.test(e.message) ? 'not_ready' : 'validation';
  }
  return 'service_error';
}
const go = (path: string, kind: 'm' | 'e', code: string, field?: string) =>
  redirect(`${path}?${kind}=${code}${code === 'validation' ? `&f=${field ?? 'form'}` : ''}`);

function issueField(issues: { path: PropertyKey[] }[]): string {
  const first = issues[0]?.path;
  if (first?.[0] === 'variants') return typeof first[2] === 'string' ? first[2] : 'variants';
  return firstIssueField(issues);
}

function readDetails(formData: FormData) {
  const attrs = parseAttributesText(str(formData.get('attributesText')));
  return {
    attrs,
    fields: {
      name: str(formData.get('name')), description: str(formData.get('description')), brand: str(formData.get('brand')),
      condition: str(formData.get('condition')), categoryId: str(formData.get('categoryId')),
      weightGrams: intField(formData.get('weightGrams')), lengthCm: intField(formData.get('lengthCm')),
      widthCm: intField(formData.get('widthCm')), heightCm: intField(formData.get('heightCm')),
      shippingRequirements: str(formData.get('shippingRequirements')),
    },
  };
}

/** Reads price fields (naira text) into kobo. Returns null when invalid. */
function readPrices(formData: FormData): { price: number; sale: number | undefined } | null {
  const price = nairaToKobo(str(formData.get('price')));
  if (price === null) return null;
  const saleRaw = str(formData.get('salePrice')).trim();
  if (!saleRaw) return { price, sale: undefined };
  const sale = nairaToKobo(saleRaw);
  return sale === null || sale >= price ? null : { price, sale };
}

export async function createProductAction(formData: FormData) {
  const { token } = await requireSession(NEW_PATH);
  const { attrs, fields } = readDetails(formData);
  if (!attrs.ok) go(NEW_PATH, 'e', 'attributes_invalid');
  const opts = parseOptionsText(str(formData.get('optionsText')));
  if (!opts.ok) go(NEW_PATH, 'e', 'options_invalid');
  const prices = readPrices(formData);
  if (!prices) go(NEW_PATH, 'e', 'price_invalid');
  if (!attrs.ok || !opts.ok || !prices) return;

  const combos = generateVariantCombinations(opts.value);
  if (combos.length > MAX_VARIANTS_PER_PRODUCT) go(NEW_PATH, 'e', 'options_invalid');
  const stock = intField(formData.get('initialStock')) ?? 0;
  const sku = str(formData.get('sku'));
  const parsed = createProductSchema.safeParse({
    ...fields, attributes: attrs.value, options: opts.value,
    variants: combos.map((c) => ({
      optionValues: c, priceKobo: prices.price, ...(prices.sale !== undefined ? { salePriceKobo: prices.sale } : {}),
      initialStock: stock, ...(combos.length === 1 && sku ? { sku } : {}),
    })),
  });
  if (!parsed.success) go(NEW_PATH, 'e', 'validation', issueField(parsed.error.issues));
  if (!parsed.success) return;

  let id = '';
  try {
    id = (await apiRequest<{ id: string }>('/seller/products', { token, method: 'POST', body: parsed.data })).id;
  } catch (e) {
    go(NEW_PATH, 'e', codeFor(e));
  }
  go(productPath(id), 'm', 'product_created');
}

export async function updateProductAction(formData: FormData) {
  const id = uuidSchema.safeParse(str(formData.get('id')));
  if (!id.success) go('/seller/products', 'e', 'not_found');
  if (!id.success) return;
  const path = productPath(id.data);
  const { token } = await requireSession(path);
  const { attrs, fields } = readDetails(formData);
  if (!attrs.ok) go(path, 'e', 'attributes_invalid');
  if (!attrs.ok) return;
  const parsed = productUpdateSchema.safeParse({ ...fields, attributes: attrs.value });
  if (!parsed.success) go(path, 'e', 'validation', issueField(parsed.error.issues));
  if (!parsed.success) return;
  try {
    await apiRequest(`/seller/products/${id.data}`, { token, method: 'PUT', body: parsed.data });
  } catch (e) {
    go(path, 'e', codeFor(e));
  }
  go(path, 'm', 'product_saved');
}

export async function productStatusAction(formData: FormData) {
  const id = uuidSchema.safeParse(str(formData.get('id')));
  const action = str(formData.get('action'));
  if (!id.success || !(SELLER_PRODUCT_ACTIONS as readonly string[]).includes(action)) go('/seller/products', 'e', 'not_found');
  if (!id.success) return;
  const path = productPath(id.data);
  const { token } = await requireSession(path);
  try {
    await apiRequest(`/seller/products/${id.data}/status`, { token, method: 'POST', body: { action } });
  } catch (e) {
    go(path, 'e', codeFor(e));
  }
  go(path, 'm', 'product_status');
}

export async function addVariantAction(formData: FormData) {
  const id = uuidSchema.safeParse(str(formData.get('id')));
  if (!id.success) go('/seller/products', 'e', 'not_found');
  if (!id.success) return;
  const path = productPath(id.data);
  const { token } = await requireSession(path);
  const optionValues: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (k.startsWith('opt_') && typeof v === 'string' && v.trim()) optionValues[k.slice(4)] = v.trim();
  const prices = readPrices(formData);
  if (!prices) go(path, 'e', 'price_invalid');
  if (!prices) return;
  const parsed = addVariantSchema.safeParse({
    optionValues, sku: str(formData.get('sku')), priceKobo: prices.price, ...(prices.sale !== undefined ? { salePriceKobo: prices.sale } : {}),
    initialStock: intField(formData.get('initialStock')) ?? 0,
  });
  if (!parsed.success) go(path, 'e', 'validation', issueField(parsed.error.issues));
  if (!parsed.success) return;
  try {
    await apiRequest(`/seller/products/${id.data}/variants`, { token, method: 'POST', body: parsed.data });
  } catch (e) {
    go(path, 'e', codeFor(e));
  }
  go(path, 'm', 'variant_added');
}

export async function updateVariantAction(formData: FormData) {
  const productId = uuidSchema.safeParse(str(formData.get('productId')));
  const variantId = uuidSchema.safeParse(str(formData.get('variantId')));
  if (!productId.success || !variantId.success) go('/seller/products', 'e', 'not_found');
  if (!productId.success || !variantId.success) return;
  const path = productPath(productId.data);
  const { token } = await requireSession(path);
  const prices = readPrices(formData);
  if (!prices) go(path, 'e', 'price_invalid');
  if (!prices) return;
  const parsed = updateVariantSchema.safeParse({
    sku: str(formData.get('sku')), priceKobo: prices.price, salePriceKobo: prices.sale ?? null, isActive: formData.get('isActive') === 'on',
  });
  if (!parsed.success) go(path, 'e', 'validation', issueField(parsed.error.issues));
  if (!parsed.success) return;
  try {
    await apiRequest(`/seller/variants/${variantId.data}`, { token, method: 'PUT', body: parsed.data });
  } catch (e) {
    go(path, 'e', codeFor(e));
  }
  go(path, 'm', 'variant_saved');
}

export async function adjustStockAction(formData: FormData) {
  const productId = uuidSchema.safeParse(str(formData.get('productId')));
  const variantId = uuidSchema.safeParse(str(formData.get('variantId')));
  if (!productId.success || !variantId.success) go('/seller/products', 'e', 'not_found');
  if (!productId.success || !variantId.success) return;
  const path = productPath(productId.data);
  const { token } = await requireSession(path);
  const parsed = stockAdjustSchema.safeParse({ delta: intField(formData.get('delta')), reason: str(formData.get('reason')), note: str(formData.get('note')) });
  if (!parsed.success) go(path, 'e', 'validation', 'delta');
  if (!parsed.success) return;
  try {
    await apiRequest(`/seller/variants/${variantId.data}/stock`, { token, method: 'POST', body: parsed.data });
  } catch (e) {
    go(path, 'e', codeFor(e));
  }
  go(path, 'm', 'stock_adjusted');
}

export async function uploadProductImageAction(formData: FormData) {
  const id = uuidSchema.safeParse(str(formData.get('id')));
  if (!id.success) go('/seller/products', 'e', 'not_found');
  if (!id.success) return;
  const path = productPath(id.data);
  const { token } = await requireSession(path);
  const file = await checkUpload(formData.get('file'), IMAGE_TYPES, MAX_PRODUCT_IMAGE_BYTES);
  if (!file.ok) go(path, 'e', file.code);
  if (!file.ok) return;

  let code = 'image_added';
  let kind: 'm' | 'e' = 'm';
  try {
    const { store } = await apiRequest<{ store: StoreProfile }>('/seller/store', { token });
    const objectPath = `${store.sellerId}/${id.data}/${randomUUID()}.${EXTENSION_BY_TYPE[file.type]}`;
    const supabase = await createSupabaseServerClient();
    const up = await supabase.storage.from('product-media').upload(objectPath, file.bytes, { contentType: MIME_BY_TYPE[file.type], upsert: false });
    if (up.error) { kind = 'e'; code = 'upload_failed'; }
    else {
      try {
        await apiRequest(`/seller/products/${id.data}/images`, { token, method: 'POST', body: { path: objectPath } });
      } catch (e) {
        await supabase.storage.from('product-media').remove([objectPath]);
        kind = 'e';
        code = e instanceof ApiError && e.status === 409 ? 'conflict_action' : 'upload_failed';
      }
    }
  } catch {
    kind = 'e';
    code = 'service_error';
  }
  go(path, kind, code);
}

export async function removeProductImageAction(formData: FormData) {
  const productId = uuidSchema.safeParse(str(formData.get('productId')));
  const imageId = uuidSchema.safeParse(str(formData.get('imageId')));
  if (!productId.success || !imageId.success) go('/seller/products', 'e', 'not_found');
  if (!productId.success || !imageId.success) return;
  const path = productPath(productId.data);
  const { token } = await requireSession(path);
  try {
    await apiRequest(`/seller/products/${productId.data}/images/${imageId.data}`, { token, method: 'DELETE' });
  } catch (e) {
    go(path, 'e', codeFor(e));
  }
  go(path, 'm', 'image_removed');
}
