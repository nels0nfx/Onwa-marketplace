import { z } from 'zod';
import { NG_STATES } from './nigeria.js';
import { ROLE_CODES } from './roles.js';
import {
  DOCUMENT_KINDS, ID_TYPE_CODES, REVIEW_ACTIONS, SELLER_CATEGORY_OPTIONS, SELLER_STATUSES, STORE_ACCENTS,
} from './seller.js';

/** Normalises Nigerian and international phone numbers to E.164. Returns null when invalid. */
export function normalizePhone(input: string): string | null {
  const raw = input.replace(/[\s\-().]/g, '');
  if (/^\+[1-9]\d{7,14}$/.test(raw)) return raw;
  if (/^234\d{10}$/.test(raw)) return `+${raw}`;
  if (/^0[789][01]\d{8}$/.test(raw)) return `+234${raw.slice(1)}`;
  return null;
}

/** Keeps only characters that are safe inside a PostgREST ilike filter. */
export function sanitizeSearchTerm(input: string): string {
  return input.replace(/[^\p{L}\p{N} @._+-]/gu, '').trim().slice(0, 64);
}

/** Only same-site relative paths are allowed as post-login redirects. */
export function safeRedirectPath(next: string | null | undefined, fallback = '/account'): string {
  if (!next) return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return fallback;
  if (/[\u0000-\u001f]/.test(next)) return fallback;
  return next;
}

export const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(72, 'Use at most 72 characters')
  .regex(/[a-z]/, 'Include a lowercase letter')
  .regex(/[A-Z]/, 'Include an uppercase letter')
  .regex(/[0-9]/, 'Include a number');

export const fullNameSchema = z
  .string()
  .trim()
  .min(2, 'Enter your full name')
  .max(100, 'Use at most 100 characters')
  .regex(/^[\p{L}\p{M}' .-]+$/u, 'Use letters, spaces, apostrophes, dots or hyphens only');

export const phoneSchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    if (value === '') return null;
    const normalised = normalizePhone(value);
    if (!normalised) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid phone number' });
      return z.NEVER;
    }
    return normalised;
  });

export const uuidSchema = z.string().uuid();

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password').max(72),
});

export const registerSchema = z
  .object({
    fullName: fullNameSchema,
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    acceptTerms: z.literal('on', { errorMap: () => ({ message: 'Accept the terms to continue' }) }),
  })
  .refine((v) => v.password === v.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' });

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({ password: passwordSchema, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' });

export const profileUpdateSchema = z
  .object({ fullName: fullNameSchema.optional(), phone: phoneSchema.optional() })
  .strict()
  .refine((v) => v.fullName !== undefined || v.phone !== undefined, { message: 'Provide at least one field to update' });

export const roleChangeSchema = z.object({ role: z.enum(ROLE_CODES) }).strict();

export const listUsersQuerySchema = z.object({
  q: z.string().optional().transform((v) => (v ? sanitizeSearchTerm(v) : undefined)),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});

export const listAuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;

// ---------------------------------------------------------------- Stage 2

const emptyToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalText = (max: number) => z.preprocess(emptyToUndefined, z.string().trim().max(max, `Use at most ${max} characters`).optional());
const requiredPhone = z.string().trim().transform((value, ctx) => {
  const normalised = normalizePhone(value);
  if (!normalised) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid phone number' });
    return z.NEVER;
  }
  return normalised;
});

export const addressSchema = z
  .object({
    label: z.preprocess(emptyToUndefined, z.string().trim().min(1).max(40).default('Home')),
    recipientName: fullNameSchema,
    phone: requiredPhone,
    line1: z.string().trim().min(3, 'Enter the street address').max(150),
    line2: optionalText(150),
    city: z.string().trim().min(2, 'Enter the city or town').max(80),
    lga: z.string().trim().min(2, 'Enter the LGA').max(80),
    state: z.enum(NG_STATES, { errorMap: () => ({ message: 'Choose a state' }) }),
    landmark: optionalText(150),
    postalCode: z.preprocess(emptyToUndefined, z.string().trim().regex(/^[0-9]{6}$/, 'Postal code has 6 digits').optional()),
    isDefault: z.boolean().optional(),
  })
  .strict();
export type AddressInput = z.infer<typeof addressSchema>;

const optionalEmail = z.preprocess(emptyToUndefined, emailSchema.optional());
const optionalPhone = z.preprocess(emptyToUndefined, requiredPhone.optional());

const applicationShape = {
  legalName: z.string().trim().min(2, 'Enter your legal name').max(120),
  businessName: z.string().trim().min(2, 'Enter your business or trading name').max(80),
  contactEmail: emailSchema,
  contactPhone: requiredPhone,
  addressLine1: z.string().trim().min(3, 'Enter the business address').max(150),
  addressCity: z.string().trim().min(2).max(80),
  addressLga: z.string().trim().min(2).max(80),
  addressState: z.enum(NG_STATES, { errorMap: () => ({ message: 'Choose a state' }) }),
  categories: z.array(z.enum(SELLER_CATEGORY_OPTIONS)).min(1, 'Choose at least one category').max(6, 'Choose at most 6 categories'),
  description: z.string().trim().min(30, 'Describe your business in at least 30 characters').max(1000),
  idType: z.enum(ID_TYPE_CODES, { errorMap: () => ({ message: 'Choose an identity document type' }) }),
  bankName: z.string().trim().min(2, 'Enter your bank name').max(60),
  bankAccountNumber: z.string().trim().regex(/^[0-9]{10}$/, 'Account numbers have 10 digits'),
  bankAccountName: z.string().trim().min(2, 'Enter the account name').max(100),
};

/** Used when saving a draft: every field optional, empty values are omitted. Omitted fields are cleared. */
export const sellerApplicationDraftSchema = z
  .object({
    legalName: z.preprocess(emptyToUndefined, applicationShape.legalName.optional()),
    businessName: z.preprocess(emptyToUndefined, applicationShape.businessName.optional()),
    contactEmail: optionalEmail,
    contactPhone: optionalPhone,
    addressLine1: z.preprocess(emptyToUndefined, applicationShape.addressLine1.optional()),
    addressCity: z.preprocess(emptyToUndefined, applicationShape.addressCity.optional()),
    addressLga: z.preprocess(emptyToUndefined, applicationShape.addressLga.optional()),
    addressState: z.preprocess(emptyToUndefined, applicationShape.addressState.optional()),
    categories: z.array(z.enum(SELLER_CATEGORY_OPTIONS)).max(6, 'Choose at most 6 categories').optional(),
    description: z.preprocess(emptyToUndefined, applicationShape.description.optional()),
    idType: z.preprocess(emptyToUndefined, applicationShape.idType.optional()),
    bankName: z.preprocess(emptyToUndefined, applicationShape.bankName.optional()),
    bankAccountNumber: z.preprocess(emptyToUndefined, applicationShape.bankAccountNumber.optional()),
    bankAccountName: z.preprocess(emptyToUndefined, applicationShape.bankAccountName.optional()),
  })
  .strict();
export type SellerApplicationDraftInput = z.infer<typeof sellerApplicationDraftSchema>;

/** Used to check a stored application before submission. */
export const sellerApplicationSubmitSchema = z.object(applicationShape).strict();

export const documentRecordSchema = z
  .object({
    kind: z.enum(DOCUMENT_KINDS),
    path: z.string().min(10).max(300),
    originalName: z.string().trim().min(1).max(200),
    mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
    sizeBytes: z.number().int().min(1).max(5 * 1024 * 1024),
  })
  .strict();

export const reviewDecisionSchema = z
  .object({ decision: z.enum(REVIEW_ACTIONS), note: optionalText(1000) })
  .strict()
  .refine((v) => !['request_info', 'reject'].includes(v.decision) || (v.note ?? '').length >= 5, {
    path: ['note'],
    message: 'A note of at least 5 characters is required for this decision',
  });

export const sellerStatusChangeSchema = z
  .object({ status: z.enum(SELLER_STATUSES), note: optionalText(1000) })
  .strict()
  .refine((v) => v.status !== 'suspended' || (v.note ?? '').length >= 5, {
    path: ['note'],
    message: 'A note of at least 5 characters is required to suspend a seller',
  });

export const storeProfileSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter a store name').max(80),
    tagline: optionalText(120),
    description: optionalText(1000),
    policies: optionalText(2000),
    deliveryInfo: optionalText(1000),
    accent: z.enum(STORE_ACCENTS),
  })
  .strict();
export type StoreProfileInput = z.infer<typeof storeProfileSchema>;

export const storeSlugSchema = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).min(3).max(60);

export const listApplicationsQuerySchema = z.object({
  status: z.enum(['draft', 'submitted', 'under_review', 'more_info_required', 'approved', 'rejected']).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});

export const listStoresQuerySchema = z.object({
  q: z.string().optional().transform((v) => (v ? sanitizeSearchTerm(v) : undefined)),
  limit: z.coerce.number().int().min(1).max(50).default(24),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});
