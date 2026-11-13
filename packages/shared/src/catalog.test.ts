import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  PRODUCT_STATUSES, SELLER_PRODUCT_ACTIONS, PRODUCT_REVIEW_ACTIONS, addVariantSchema, browseProductsQuerySchema, categoryCreateSchema,
  createProductSchema, formatNaira, generateVariantCombinations, imageRecordSchema, isProductEditable, koboToNairaInput, nairaToKobo,
  nextProductStatusForReview, nextProductStatusForSeller, parseAttributesText, parseOptionsText, productDecisionSchema,
  stockAdjustSchema, updateVariantSchema, variantLabel, MAX_PRICE_KOBO, productMissing,
} from './catalog.js';

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(resolve(here, '../../../supabase/migrations/0011_catalog.sql'), 'utf8');

test('money: naira text to integer kobo without floating point', () => {
  assert.equal(nairaToKobo('1500'), 150000);
  assert.equal(nairaToKobo('1,500.5'), 150050);
  assert.equal(nairaToKobo('₦2000.00'), 200000);
  assert.equal(nairaToKobo('0.07'), 7);
  assert.equal(nairaToKobo('19.99'), 1999);
  assert.equal(nairaToKobo('0'), null);
  assert.equal(nairaToKobo('-5'), null);
  assert.equal(nairaToKobo('10.999'), null);
  assert.equal(nairaToKobo('abc'), null);
  assert.equal(nairaToKobo(''), null);
  assert.equal(nairaToKobo('100000000'), MAX_PRICE_KOBO);
  assert.equal(nairaToKobo('100000001'), null);
});

test('money: formatting and round-trip', () => {
  assert.equal(formatNaira(1000000), '₦10,000');
  assert.equal(formatNaira(150050), '₦1,500.50');
  assert.equal(formatNaira(7), '₦0.07');
  assert.equal(formatNaira(123456789), '₦1,234,567.89');
  assert.equal(koboToNairaInput(150050), '1500.50');
  assert.equal(koboToNairaInput(150000), '1500');
  for (const n of ['1', '12.34', '999999.99', '0.01']) assert.equal(koboToNairaInput(nairaToKobo(n) as number), n);
});

test('options parsing', () => {
  const r = parseOptionsText('Size: S, M, L\nColor: Red, Blue, red');
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.value, [{ name: 'Size', values: ['S', 'M', 'L'] }, { name: 'Color', values: ['Red', 'Blue'] }]);
  assert.deepEqual(parseOptionsText('').ok && (parseOptionsText('') as { value: unknown[] }).value, []);
  assert.equal(parseOptionsText('Size S M L').ok, false);
  assert.equal(parseOptionsText('Size: \n').ok, false);
  assert.equal(parseOptionsText('A: 1\nB: 2\nC: 3\nD: 4').ok, false);
  assert.equal(parseOptionsText('Size: S\nsize: M').ok, false, 'duplicate option names');
  assert.equal(parseOptionsText(`Size: ${Array.from({ length: 11 }, (_, i) => `v${i}`).join(',')}`).ok, false);
});

test('variant combinations', () => {
  assert.deepEqual(generateVariantCombinations([]), [{}]);
  const c = generateVariantCombinations([{ name: 'Size', values: ['S', 'M'] }, { name: 'Color', values: ['Red', 'Blue', 'Green'] }]);
  assert.equal(c.length, 6);
  assert.deepEqual(c[0], { Size: 'S', Color: 'Red' });
  assert.equal(variantLabel({ Size: 'S', Color: 'Red' }), 'S / Red');
  assert.equal(variantLabel({}), 'Standard');
});

test('attributes parsing', () => {
  const r = parseAttributesText('Material: Cotton\nOrigin: Nigeria');
  assert.equal(r.ok && r.value.Material, 'Cotton');
  assert.equal(parseAttributesText('no colon here').ok, false);
  assert.equal(parseAttributesText(Array.from({ length: 21 }, (_, i) => `k${i}: v`).join('\n')).ok, false);
});

test('seller status machine', () => {
  assert.deepEqual(nextProductStatusForSeller('draft', 'submit'), { allowed: true, to: 'pending_review' });
  assert.deepEqual(nextProductStatusForSeller('rejected', 'submit'), { allowed: true, to: 'pending_review' });
  assert.deepEqual(nextProductStatusForSeller('pending_review', 'withdraw'), { allowed: true, to: 'draft' });
  assert.deepEqual(nextProductStatusForSeller('approved', 'archive'), { allowed: true, to: 'archived' });
  assert.deepEqual(nextProductStatusForSeller('archived', 'restore'), { allowed: true, to: 'draft' });
  assert.equal(nextProductStatusForSeller('approved', 'submit').allowed, false);
  assert.equal(nextProductStatusForSeller('pending_review', 'archive').allowed, false);
  assert.equal(nextProductStatusForSeller('draft', 'restore').allowed, false);
  assert.equal(nextProductStatusForSeller('archived', 'submit').allowed, false);
});

test('review machine: only pending listings; notes required for changes and rejection', () => {
  assert.deepEqual(nextProductStatusForReview('pending_review', 'approve'), { allowed: true, to: 'approved' });
  assert.equal(nextProductStatusForReview('pending_review', 'reject').allowed, false);
  assert.equal(nextProductStatusForReview('pending_review', 'reject', 'Counterfeit goods').allowed, true);
  assert.equal(nextProductStatusForReview('pending_review', 'request_changes', 'Add clearer photos').allowed, true);
  for (const s of PRODUCT_STATUSES.filter((x) => x !== 'pending_review')) {
    for (const a of PRODUCT_REVIEW_ACTIONS) assert.equal(nextProductStatusForReview(s, a, 'long enough note').allowed, false, `${s}/${a}`);
  }
});

test('editability: not while awaiting review or archived', () => {
  assert.equal(isProductEditable('draft'), true);
  assert.equal(isProductEditable('approved'), true);
  assert.equal(isProductEditable('pending_review'), false);
  assert.equal(isProductEditable('archived'), false);
});

test('SQL statuses, actions and rules match TypeScript', () => {
  for (const s of PRODUCT_STATUSES) assert.ok(sql.includes(`'${s}'`), `status ${s}`);
  for (const a of [...SELLER_PRODUCT_ACTIONS, ...PRODUCT_REVIEW_ACTIONS]) assert.ok(sql.includes(`'${a}'`), `action ${a}`);
  assert.ok(sql.includes('10000000000'), 'max price constant parity');
  assert.ok(sql.includes('stock_quantity + p_delta >= 0'), 'atomic no-oversell guard present');
});

const base = { name: 'Ankara Tote Bag', condition: 'new', variants: [{ priceKobo: 1500000, initialStock: 5 }] };

test('createProductSchema: simple product, defaults, normalisation', () => {
  const r = createProductSchema.safeParse({ ...base, description: '', weightGrams: 400 });
  assert.equal(r.success, true);
  if (r.success) {
    assert.equal(r.data.description, undefined);
    assert.deepEqual(r.data.options, []);
    assert.deepEqual(r.data.variants[0]?.optionValues, {});
  }
});

test('createProductSchema: variants must match the options exactly', () => {
  const options = [{ name: 'Size', values: ['S', 'M'] }];
  const ok = { ...base, options, variants: [{ optionValues: { Size: 'S' }, priceKobo: 100, initialStock: 1 }, { optionValues: { Size: 'M' }, priceKobo: 100, initialStock: 1 }] };
  assert.equal(createProductSchema.safeParse(ok).success, true);
  assert.equal(createProductSchema.safeParse({ ...ok, variants: [{ optionValues: { Size: 'XL' }, priceKobo: 100 }] }).success, false, 'unlisted value');
  assert.equal(createProductSchema.safeParse({ ...ok, variants: [{ optionValues: {}, priceKobo: 100 }] }).success, false, 'missing option');
  assert.equal(createProductSchema.safeParse({ ...ok, variants: [{ optionValues: { Size: 'S' }, priceKobo: 100 }, { optionValues: { Size: 'S' }, priceKobo: 100 }] }).success, false, 'duplicate combination');
  assert.equal(createProductSchema.safeParse({ ...ok, variants: [{ optionValues: { Size: 'S', Color: 'Red' }, priceKobo: 100 }] }).success, false, 'extra option');
});

test('createProductSchema: prices, stock, sale price, SKU, extra keys', () => {
  const v = (x: object) => createProductSchema.safeParse({ ...base, variants: [{ priceKobo: 1000, ...x }] }).success;
  assert.equal(v({ salePriceKobo: 900 }), true);
  assert.equal(v({ salePriceKobo: 1000 }), false);
  assert.equal(v({ salePriceKobo: 1500 }), false);
  assert.equal(v({ initialStock: -1 }), false);
  assert.equal(v({ initialStock: 1.5 }), false);
  assert.equal(v({ sku: 'BAG-001' }), true);
  assert.equal(v({ sku: 'bad sku!' }), false);
  assert.equal(createProductSchema.safeParse({ ...base, variants: [{ priceKobo: 0 }] }).success, false);
  assert.equal(createProductSchema.safeParse({ ...base, variants: [{ priceKobo: MAX_PRICE_KOBO + 1 }] }).success, false);
  assert.equal(createProductSchema.safeParse({ ...base, variants: [] }).success, false);
  assert.equal(createProductSchema.safeParse({ ...base, status: 'approved' }).success, false);
  assert.equal(createProductSchema.safeParse({ ...base, sellerId: 'x' }).success, false);
  assert.equal(createProductSchema.safeParse({ ...base, name: 'ab' }).success, false);
  assert.equal(createProductSchema.safeParse({ ...base, weightGrams: 0 }).success, false);
  assert.equal(createProductSchema.safeParse({ ...base, weightGrams: 100001 }).success, false);
});

test('variant, stock, decision, image, category schemas', () => {
  assert.equal(addVariantSchema.safeParse({ optionValues: { Size: 'L' }, priceKobo: 5000 }).success, true);
  assert.equal(updateVariantSchema.safeParse({ priceKobo: 5000, salePriceKobo: null, isActive: true }).success, true);
  assert.equal(updateVariantSchema.safeParse({ priceKobo: 5000, salePriceKobo: 6000, isActive: true }).success, false);
  assert.equal(stockAdjustSchema.safeParse({ delta: 10, reason: 'restock' }).success, true);
  assert.equal(stockAdjustSchema.safeParse({ delta: -3, reason: 'correction' }).success, true);
  assert.equal(stockAdjustSchema.safeParse({ delta: 0, reason: 'restock' }).success, false);
  assert.equal(stockAdjustSchema.safeParse({ delta: 5, reason: 'sale' }).success, false, 'sellers cannot fake sales');
  assert.equal(productDecisionSchema.safeParse({ decision: 'approve' }).success, true);
  assert.equal(productDecisionSchema.safeParse({ decision: 'reject' }).success, false);
  assert.equal(productDecisionSchema.safeParse({ decision: 'reject', note: 'Prohibited item' }).success, true);
  assert.equal(imageRecordSchema.safeParse({ path: 'seller/product/img.png' }).success, true);
  assert.equal(categoryCreateSchema.safeParse({ name: 'Shoes' }).success, true);
  assert.equal(categoryCreateSchema.safeParse({ name: 'S' }).success, false);
});

test('browse query: sanitises search, bounds paging, coerces numbers', () => {
  const q = browseProductsQuerySchema.parse({ q: 'bag,(x)%', minPriceKobo: '1000', inStock: '1', sort: 'price_asc' });
  assert.equal(q.q, 'bagx');
  assert.equal(q.minPriceKobo, 1000);
  assert.equal(q.inStock, true);
  assert.equal(q.sort, 'price_asc');
  assert.equal(browseProductsQuerySchema.parse({}).inStock, false);
  assert.equal(browseProductsQuerySchema.safeParse({ limit: '500' }).success, false);
  assert.equal(browseProductsQuerySchema.safeParse({ sort: 'random' }).success, false);
  assert.equal(browseProductsQuerySchema.safeParse({ category: 'Bad Slug' }).success, false);
});

test('productMissing lists what blocks submission', () => {
  const ready = { description: 'A sturdy handmade tote bag.', categoryId: 'c', weightGrams: 400, images: [1], variants: [{ isActive: true }] };
  assert.deepEqual(productMissing(ready), []);
  assert.equal(productMissing({ ...ready, description: 'short' }).length, 1);
  assert.equal(productMissing({ ...ready, categoryId: null }).length, 1);
  assert.equal(productMissing({ ...ready, weightGrams: null }).length, 1);
  assert.equal(productMissing({ ...ready, images: [] }).length, 1);
  assert.equal(productMissing({ ...ready, variants: [{ isActive: false }] }).length, 1);
  assert.equal(productMissing({ description: null, categoryId: null, weightGrams: null, images: [], variants: [] }).length, 5);
});
