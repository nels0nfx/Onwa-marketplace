import { Router } from 'express';
import { profileUpdateSchema, type MeResponse } from '@onwa/shared';
import type { AppDeps } from '../../deps.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { parseOrThrow } from '../../middleware/validate.js';
import { unauthorized } from '../../lib/errors.js';

/** Routes for the signed-in user. The caller must already be authenticated. */
export function meRoutes(deps: Pick<AppDeps, 'users'>): Router {
  const router = Router();

  router.get('/me', (req, res) => {
    if (!req.auth) throw unauthorized();
    const body: MeResponse = { profile: req.auth.profile, roles: req.auth.roles, permissions: req.auth.permissions };
    res.json(body);
  });

  router.patch(
    '/me',
    asyncHandler(async (req, res) => {
      if (!req.auth) throw unauthorized();
      const patch = parseOrThrow(profileUpdateSchema, req.body);
      // Only whitelisted fields reach the repository; status, email and roles can never be set here.
      const profile = await deps.users.updateProfile(req.auth.userId, {
        ...(patch.fullName !== undefined ? { fullName: patch.fullName } : {}),
        ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
      });
      const body: MeResponse = { profile, roles: req.auth.roles, permissions: req.auth.permissions };
      res.json(body);
    }),
  );

  return router;
}
