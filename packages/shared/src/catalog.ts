import { z } from 'zod';

// ---------------------------------------------------------------- statuses
export const PRODUCT_STATUSES = ['draft', 'pending_review', 'changes_requested', 'approved', 'rejected', 'archived'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const PRODUCT_STATUS_LABELS: Record<ProductStatus, string> = {
  draft: 'Draft',
  pending_review: 'Awaiting review',
  changes_requested: 'Changes requested',
  approved: 'Live',
  rejected: 'Rejected',
  archived: 'Archived',
};

export const SELLER_PRODUCT_ACTIONS = ['submit', 'withdraw', 'archive', 'restore'] as const;
export type SellerProductAction = (typeof SELLER_PRODUCT_ACTIONS)[number];

export const SELLER_PRODUCT_TRANSITIONS: Record<SellerProductAction, { from: readonly ProductStatus[]; to: ProductStatus }> = {
  submit: { from: ['draft', 'changes_requested', 'rejected'], to: 'pending_review' },
  withdraw: { from: ['pending_review'], to: 'draft' },
  archive: { from: ['draft', 'changes_requested', 'rejected', 'approved'], to: 'archived' },
  restore: { from: ['archived'], to: 'draft' },
};

export const PRODUCT_REVIEW_ACTIONS = ['approve', 'request_changes', 'reject'] as const;
export type ProductReviewAction = (typeof PRODUCT_REVIEW_ACTIONS)[number];

export const PRODUCT_REVIEW_TRANSITIONS: Record<ProductReviewAction, { to: ProductStatus; noteRequired: boolean }> = {
  approve: { to: 'approved', noteRequired: false },
  request_changes: { to: 'changes_requested', noteRequired: true },
  reject: { to: 'rejected', noteRequired: true },
};

export type ProductTransition = { allowed: true; to: ProductStatus } | { allowed: false; reason: string };

/** Mirrors public.seller_change_product_status. */
export function nextProductStatusForSeller(current: ProductStatus, action: SellerProductAction): ProductTransition {
  const rule = SELLER_PRODUCT_TRANSITIONS[action];
  if (!rule.from.includes(current)) {
    return { allowed: false, reason: `Cannot ${action} a listing that is ${PRODUCT_STATUS_LABELS[current].toLowerCase()}` };
  }
  return { allowed: true, to: rule.to };
}

/** Mirrors public.review_product. Only listings awaiting review can be decided. */
export function nextProductStatusForReview(current: ProductStatus, action: ProductReviewAction, note?: string | null): ProductTransition {
  if (current !== 'pending_review') {
    return { allowed: false, reason: `Only listings awaiting review can be decided (this one is ${PRODUCT_STATUS_LABELS[current].toLowerCase()})` };
  }
  const rule = PRODUCT_REVIEW_TRANSITIONS[action];
  if (rule.noteRequired && (note ?? '').trim().length < 5) {
    return { allowed: false, reason: 'A note of at least 5 characters is required for this decision' };
  }
  return { allowed: true, to: rule.to };
}

/** Whether the seller may currently edit product details. */
export function isProductEditable(status: ProductStatus): boolean {
  return status === 'draft' || status === 'changes_requested' || status === 'rejected' || status === 'approved';
}

export const PRODUCT_CONDITIONS = ['new', 'used', 'refurbished'] as const;
export type ProductCondition = (typeof PRODUCT_CONDITIONS)[number];

export const STOCK_REASONS_SELLER = ['restock', 'adjustment', 'correction'] as const;
export const STOCK_REASONS_ALL = ['initial', 'restock', 'adjustment', 'correction', 'sale', 'cancellation', 'return'] as const;
export const LOW_STOCK_THRESHOLD = 5;
export const MAX_IMAGES_PER_PRODUCT = 8;
export const MAX_PRODUCT_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_VARIANTS_PER_PRODUCT = 100;

// ---------------------------------------------------------------- money (integer kobo only, never floats)
export const MAX_PRICE_KOBO = 10_000_000_000; // 100,000,000 naira

/** Parses a naira amount typed by a person ("1,500", "1500.5", "₦2000.00") into integer kobo. Returns null if invalid. */
export function nairaToKobo(input: string): number | null {
  const cleaned = input.replace(/[₦\s,]/g, '');
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!m) return null;
  const whole = Number(m[1]);
  const frac = Number((m[2] ?? '').padEnd(2, '0') || '0');
  const kobo = whole * 100 + frac;
  return kobo > 0 && kobo <= MAX_PRICE_KOBO ? kobo : null;
}

/** Plain decimal string for form fields, e.g. 150050 -> "1500.50", 150000 -> "1500". */
export function koboToNairaInput(kobo: number): string {
  const whole = Math.trunc(kobo / 100);
  const frac = kobo % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, '0')}`;
}

/** Display string, e.g. 150050 -> "₦1,500.50". Integer arithmetic only. */
export function formatNaira(kobo: number): string {
  const whole = Math.trunc(kobo / 100);
  const frac = kobo % 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac === 0 ? `₦${grouped}` : `₦${grouped}.${String(frac).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- options, variants, attributes
export interface ProductOption { name: string; values: string[] }

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** "Size: S, M, L" per line -> options. Max 3 options, 1-10 values each. */
export function parseOptionsText(text: string): ParseResult<ProductOption[]> {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 3) return { ok: false, error: 'Use at most 3 options (for example Size, Color, Material)' };
  const options: ProductOption[] = [];
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx < 1) return { ok: false, error: `Write each option like "Size: S, M, L" (problem with "${line.slice(0, 30)}")` };
    const name = line.slice(0, idx).trim();
    if (name.length === 0 || name.length > 30) return { ok: false, error: 'Option names must be 1 to 30 characters' };
    if (options.some((o) => o.name.toLowerCase() === name.toLowerCase())) return { ok: false, error: `Option "${name}" is listed twice` };
    const seen = new Set<string>();
    const values: string[] = [];
    for (const raw of line.slice(idx + 1).split(',')) {
      const v = raw.trim();
      if (!v || seen.has(v.toLowerCase())) continue;
      if (v.length > 40) return { ok: false, error: 'Option values must be at most 40 characters' };
      seen.add(v.toLowerCase());
      values.push(v);
    }
    if (values.length === 0) return { ok: false, error: `Give "${name}" at least one value` };
    if (values.length > 10) return { ok: false, error: `"${name}" has more than 10 values` };
    options.push({ name, values });
  }
  return { ok: true, value: options };
}

/** Every combination of option values. [] options -> a single empty combination (a product with no variations). */
export function generateVariantCombinations(options: readonly ProductOption[]): Record<string, string>[] {
  let combos: Record<string, string>[] = [{}];
  for (const opt of options) {
    const next: Record<string, string>[] = [];
    for (const c of combos) for (const v of opt.values) next.push({ ...c, [opt.name]: v });
    combos = next;
  }
  return combos;
}

/** "Material: Cotton" per line -> attributes map. Max 20 entries. */
export function parseAttributesText(text: string): ParseResult<Record<string, string>> {
  const out: Record<string, string> = {};
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > 20) return { ok: false, error: 'Use at most 20 attributes' };
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx < 1) return { ok: false, error: `Write each attribute like "Material: Cotton" (problem with "${line.slice(0, 30)}")` };
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (!k || !v || k.length > 40 || v.length > 200) return { ok: false, error: 'Attribute names are up to 40 characters and values up to 200' };
    out[k] = v;
  }
  return { ok: true, value: out };
}

export function optionsToText(options: readonly ProductOption[]): string {
  return options.map((o) => `${o.name}: ${o.values.join(', ')}`).join('\n');
}
export function attributesToText(attrs: Record<string, string>): string {
  return Object.entries(attrs).map(([k, v]) => `${k}: ${v}`).join('\n');
}

export function variantLabel(optionValues: Record<string, string>): string {
  const vals = Object.values(optionValues);
  return vals.length ? vals.join(' / ') : 'Standard';
}

// ---------------------------------------------------------------- validation
const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optText = (max: number) => z.preprocess(emptyToUndefined, z.string().trim().max(max, `Use at most ${max} characters`).optional());
const optInt = (min: number, max: number, msg: string) =>
  z.preprocess((v) => (v === '' || v === null ? undefined : v), z.number().int(msg).min(min, msg).max(max, msg).optional());

export const productFieldsShape = {
  name: z.string().trim().min(3, 'Enter a product name of at least 3 characters').max(120),
  description: optText(5000),
  brand: optText(80),
  condition: z.enum(PRODUCT_CONDITIONS),
  categoryId: z.preprocess(emptyToUndefined, z.string().uuid('Choose a category').optional()),
  weightGrams: optInt(1, 100_000, 'Weight must be between 1 g and 100 kg'),
  lengthCm: optInt(1, 300, 'Length must be 1 to 300 cm'),
  widthCm: optInt(1, 300, 'Width must be 1 to 300 cm'),
  heightCm: optInt(1, 300, 'Height must be 1 to 300 cm'),
  shippingRequirements: optText(500),
  attributes: z.record(z.string().min(1).max(40), z.string().min(1).max(200)).refine((r) => Object.keys(r).length <= 20, 'Use at most 20 attributes').optional(),
};

export const productUpdateSchema = z.object(productFieldsShape).strict();
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;

const priceKobo = z.number().int().min(1, 'Enter a price').max(MAX_PRICE_KOBO, 'Price is too high');
const sku = z.preprocess(emptyToUndefined, z.string().trim().min(1).max(60).regex(/^[A-Za-z0-9._\-\/]+$/, 'SKU can use letters, numbers and . _ - /').optional());

export const variantInputSchema = z
  .object({
    optionValues: z.record(z.string().min(1).max(30), z.string().min(1).max(40)).default({}),
    sku,
    priceKobo,
    salePriceKobo: z.number().int().min(1).max(MAX_PRICE_KOBO).optional(),
    initialStock: z.number().int().min(0, 'Stock cannot be negative').max(1_000_000).default(0),
  })
  .strict()
  .refine((v) => v.salePriceKobo === undefined || v.salePriceKobo < v.priceKobo, { path: ['salePriceKobo'], message: 'Sale price must be lower than the regular price' });
export type VariantInput = z.infer<typeof variantInputSchema>;

const optionSchema = z.object({ name: z.string().trim().min(1).max(30), values: z.array(z.string().trim().min(1).max(40)).min(1).max(10) }).strict();

/** Checks that variant option values only use declared options/values and that no combination repeats. */
function optionsConsistent(options: ProductOption[], variants: { optionValues: Record<string, string> }[]): string | null {
  const names = options.map((o) => o.name);
  const seen = new Set<string>();
  for (const v of variants) {
    const keys = Object.keys(v.optionValues);
    if (keys.length !== names.length || !names.every((n) => keys.includes(n))) return 'Every variant must choose a value for each option';
    for (const o of options) {
      if (!o.values.includes(v.optionValues[o.name] as string)) return `"${v.optionValues[o.name]}" is not a listed value of ${o.name}`;
    }
    const key = JSON.stringify(names.map((n) => v.optionValues[n]));
    if (seen.has(key)) return 'Two variants have the same combination';
    seen.add(key);
  }
  return null;
}

export const createProductSchema = z
  .object({
    ...productFieldsShape,
    options: z.array(optionSchema).max(3).default([]),
    variants: z.array(variantInputSchema).min(1, 'Add at least one variant').max(MAX_VARIANTS_PER_PRODUCT),
  })
  .strict()
  .superRefine((v, ctx) => {
    const err = optionsConsistent(v.options, v.variants);
    if (err) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['variants'], message: err });
  });
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const addVariantSchema = variantInputSchema;
export const updateVariantSchema = z
  .object({ sku, priceKobo, salePriceKobo: z.number().int().min(1).max(MAX_PRICE_KOBO).nullable().optional(), isActive: z.boolean() })
  .strict()
  .refine((v) => v.salePriceKobo == null || v.salePriceKobo < v.priceKobo, { path: ['salePriceKobo'], message: 'Sale price must be lower than the regular price' });
export type UpdateVariantInput = z.infer<typeof updateVariantSchema>;

export const stockAdjustSchema = z
  .object({
    delta: z.number().int().min(-1_000_000).max(1_000_000).refine((n) => n !== 0, 'Enter a quantity other than zero'),
    reason: z.enum(STOCK_REASONS_SELLER),
    note: optText(200),
  })
  .strict();

export const productActionSchema = z.object({ action: z.enum(SELLER_PRODUCT_ACTIONS) }).strict();

export const productDecisionSchema = z
  .object({ decision: z.enum(PRODUCT_REVIEW_ACTIONS), note: optText(1000) })
  .strict()
  .refine((v) => v.decision === 'approve' || (v.note ?? '').length >= 5, { path: ['note'], message: 'A note of at least 5 characters is required for this decision' });

export const imageRecordSchema = z.object({ path: z.string().min(10).max(300), altText: optText(150) }).strict();

export const categoryCreateSchema = z
  .object({ name: z.string().trim().min(2, 'Enter a category name').max(60), parentId: z.preprocess(emptyToUndefined, z.string().uuid().optional()), sortOrder: z.number().int().min(0).max(9999).default(100) })
  .strict();
export const categoryUpdateSchema = z
  .object({ name: z.string().trim().min(2).max(60), sortOrder: z.number().int().min(0).max(9999), isActive: z.boolean() })
  .strict();

export const PRODUCT_SORTS = ['newest', 'price_asc', 'price_desc'] as const;
export const browseProductsQuerySchema = z.object({
  q: z.string().optional().transform((v) => (v ? v.replace(/[^\p{L}\p{N} @._+-]/gu, '').trim().slice(0, 64) : undefined)),
  category: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(80).optional(),
  store: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(60).optional(),
  condition: z.enum(PRODUCT_CONDITIONS).optional(),
  minPriceKobo: z.coerce.number().int().min(0).max(MAX_PRICE_KOBO).optional(),
  maxPriceKobo: z.coerce.number().int().min(0).max(MAX_PRICE_KOBO).optional(),
  inStock: z.enum(['1', 'true']).optional().transform((v) => v !== undefined),
  sort: z.enum(PRODUCT_SORTS).default('newest'),
  limit: z.coerce.number().int().min(1).max(48).default(24),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});
export type BrowseProductsQuery = z.infer<typeof browseProductsQuerySchema>;

export const listProductsQuerySchema = z.object({
  status: z.enum(PRODUCT_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});

export const productSlugSchema = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).min(3).max(90);

/** Mirrors public.product_missing: what still blocks a listing from being submitted or approved. */
export function productMissing(p: {
  description: string | null; categoryId: string | null; weightGrams: number | null;
  images: readonly unknown[]; variants: readonly { isActive: boolean }[];
}): string[] {
  const m: string[] = [];
  if ((p.description ?? '').trim().length < 20) m.push('A description of at least 20 characters');
  if (!p.categoryId) m.push('A category');
  if (p.weightGrams === null) m.push('The weight (used for delivery)');
  if (!p.variants.some((v) => v.isActive)) m.push('At least one active variant');
  if (p.images.length === 0) m.push('At least one image');
  return m;
}
