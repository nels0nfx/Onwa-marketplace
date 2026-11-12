import { Router } from 'express';
import type { RequestHandler } from 'express';
import { addressSchema, uuidSchema } from '@onwa/shared';
import type { AppDeps } from '../../deps.js';
import { unauthorized } from '../../lib/errors.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { parseOrThrow } from '../../middleware/validate.js';

/** A customer's own delivery addresses. Every query is scoped to the authenticated user id. */
export function addressRoutes(deps: Pick<AppDeps, 'addresses'>, limits: { userWrites: RequestHandler }): Router {
  const router = Router();

  router.get('/me/addresses', asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthorized();
    res.json({ addresses: await deps.addresses.list(req.auth.userId) });
  }));

  router.post('/me/addresses', limits.userWrites, asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthorized();
    const input = parseOrThrow(addressSchema, req.body);
    res.status(201).json({ address: await deps.addresses.create(req.auth.userId, input) });
  }));

  router.put('/me/addresses/:id', limits.userWrites, asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthorized();
    const id = parseOrThrow(uuidSchema, req.params.id);
    const input = parseOrThrow(addressSchema, req.body);
    res.json({ address: await deps.addresses.replace(req.auth.userId, id, input) });
  }));

  router.delete('/me/addresses/:id', limits.userWrites, asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthorized();
    await deps.addresses.remove(req.auth.userId, parseOrThrow(uuidSchema, req.params.id));
    res.status(204).end();
  }));

  return router;
}
