import { Router } from 'express';
import { listStoresQuerySchema, storeSlugSchema } from '@onwa/shared';
import type { AppDeps } from '../../deps.js';
import { notFound } from '../../lib/errors.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { parseOrThrow } from '../../middleware/validate.js';

/** Public storefront reads. No authentication. Only public fields of active sellers' stores are ever returned. */
export function publicStoreRoutes(deps: Pick<AppDeps, 'sellers'>): Router {
  const router = Router();

  router.get('/stores', asyncHandler(async (req, res) => {
    const q = parseOrThrow(listStoresQuerySchema, req.query);
    res.json(await deps.sellers.listStores({ ...(q.q ? { q: q.q } : {}), limit: q.limit, offset: q.offset }));
  }));

  router.get('/stores/:slug', asyncHandler(async (req, res) => {
    const store = await deps.sellers.getPublicStore(parseOrThrow(storeSlugSchema, req.params.slug));
    if (!store) throw notFound('Store not found');
    res.json({ store });
  }));

  return router;
}
