import { z } from 'zod';
import { ROLE_CODES } from './roles.js';

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
