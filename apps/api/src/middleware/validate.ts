import type { ZodTypeAny, z } from 'zod';
import { validationError } from '../lib/errors.js';

export function parseOrThrow<S extends ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw validationError(result.error.issues.map((i) => ({ field: i.path.join('.') || 'body', message: i.message })));
  }
  return result.data;
}
