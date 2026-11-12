import rateLimit from 'express-rate-limit';
import type { RequestHandler } from 'express';
import type { Env } from '../config/env.js';

const body = (message: string) => ({ error: { code: 'rate_limited', message } });

/**
 * In-memory limiter: correct for a single API instance. Before running more than one
 * instance, back this with a shared store (e.g. Redis) - see docs/SECURITY.md.
 */
export function createRateLimiters(env: Pick<Env, 'RATE_LIMIT_GLOBAL_PER_15_MIN' | 'RATE_LIMIT_ADMIN_WRITES_PER_MIN' | 'RATE_LIMIT_USER_WRITES_PER_MIN'>): {
  global: RequestHandler;
  adminWrites: RequestHandler;
  userWrites: RequestHandler;
} {
  return {
    global: rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: env.RATE_LIMIT_GLOBAL_PER_15_MIN,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: body('Too many requests. Please slow down.'),
    }),
    adminWrites: rateLimit({
      windowMs: 60 * 1000,
      limit: env.RATE_LIMIT_ADMIN_WRITES_PER_MIN,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      keyGenerator: (req) => req.auth?.userId ?? 'anonymous',
      message: body('Too many administrative changes. Wait a minute and try again.'),
    }),
    userWrites: rateLimit({
      windowMs: 60 * 1000,
      limit: env.RATE_LIMIT_USER_WRITES_PER_MIN,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      keyGenerator: (req) => req.auth?.userId ?? 'anonymous',
      message: body('Too many changes in a short time. Wait a minute and try again.'),
    }),
  };
}
