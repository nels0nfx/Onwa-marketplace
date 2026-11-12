import { z } from 'zod';

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    SUPABASE_URL: z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20, 'SUPABASE_SERVICE_ROLE_KEY looks too short'),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:3000')
      .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean)),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    RATE_LIMIT_GLOBAL_PER_15_MIN: z.coerce.number().int().positive().default(300),
    RATE_LIMIT_ADMIN_WRITES_PER_MIN: z.coerce.number().int().positive().default(20),
    RATE_LIMIT_USER_WRITES_PER_MIN: z.coerce.number().int().positive().default(60),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  })
  .superRefine((env, ctx) => {
    if (env.CORS_ORIGINS.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['CORS_ORIGINS'], message: 'At least one origin is required' });
    }
    for (const origin of env.CORS_ORIGINS) {
      if (origin === '*') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['CORS_ORIGINS'], message: 'Wildcard origins are not allowed' });
      } else if (env.NODE_ENV === 'production' && !origin.startsWith('https://')) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['CORS_ORIGINS'], message: `Production origin must use https: ${origin}` });
      }
    }
  });

export type Env = z.infer<typeof schema>;

export function loadEnv(source: Record<string, string | undefined>): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.') || 'env'}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${detail}`);
  }
  return parsed.data;
}
