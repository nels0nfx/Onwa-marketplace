import type { RequestHandler } from 'express';
import type { AppDeps } from '../deps.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { asyncHandler } from './asyncHandler.js';

const BEARER = /^Bearer ([A-Za-z0-9\-_.]+)$/;

/** Verifies the Supabase JWT, loads the profile and effective roles/permissions. */
export function authenticate(deps: Pick<AppDeps, 'tokenVerifier' | 'users'>): RequestHandler {
  return asyncHandler(async (req, _res, next) => {
    const match = BEARER.exec(req.header('authorization') ?? '');
    if (!match?.[1]) throw unauthorized();

    const user = await deps.tokenVerifier.verify(match[1]);
    if (!user) throw unauthorized('Invalid or expired session');

    const profile = await deps.users.getProfile(user.id);
    if (!profile) throw unauthorized('Account not found');
    if (profile.status !== 'active') throw forbidden('This account is not active');

    const access = await deps.users.getAccess(user.id);
    req.auth = { userId: user.id, email: user.email, profile, roles: access.roles, permissions: access.permissions };
    next();
  });
}
