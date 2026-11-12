import { Router } from 'express';
import type { RequestHandler } from 'express';
import { z } from 'zod';
import {
  canApplicantSubmit, documentRecordSchema, sellerApplicationDraftSchema, storeProfileSchema, storeSlugSchema, uuidSchema,
} from '@onwa/shared';
import type { AppDeps } from '../../deps.js';
import { badRequest, forbidden, notFound, unauthorized } from '../../lib/errors.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { parseOrThrow } from '../../middleware/validate.js';

const mediaSchema = z.object({ kind: z.enum(['logo', 'cover']), path: z.string().min(10).max(300) }).strict();

/** Seller-facing routes: apply, upload documents, manage own store, follow stores. All scoped to req.auth.userId. */
export function sellerRoutes(deps: Pick<AppDeps, 'sellers'>, limits: { userWrites: RequestHandler }): Router {
  const router = Router();

  router.get('/seller/application', asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthorized();
    res.json({ application: await deps.sellers.getMyApplication(req.auth.userId) });
  }));

  router.put('/seller/application', limits.userWrites, asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthorized();
    if (req.auth.roles.includes('seller')) throw forbidden('You are already a seller');
    const draft = parseOrThrow(sellerApplicationDraftSchema, req.body);
    res.json({ application: await deps.sellers.saveApplication(req.auth.userId, draft) });
  }));

  router.post('/seller/application/submit', limits.userWrites, asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthorized();
    res.json({ application: await deps.sellers.submitApplication(req.auth.userId) });
  }));

  router.post('/seller/application/documents', limits.userWrites, asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthorized();
    const input = parseOrThrow(documentRecordSchema, req.body);
    const app = await deps.sellers.getMyApplication(req.auth.userId);
    if (!app) throw notFound('Start your application first');
    if (!canApplicantSubmit(app.status)) throw forbidden('The application can no longer be edited');

    // The file must live in this user's own folder for this application, with a server-style name.
    const expected = new RegExp(`^${req.auth.userId}/${app.id}/[0-9a-f-]{36}\\.(pdf|jpg|png)$`);
    if (!expected.test(input.path)) throw badRequest('Invalid file location');
    if (!(await deps.sellers.objectExists('seller-documents', input.path))) throw badRequest('The uploaded file was not found');

    const doc = await deps.sellers.addDocument(req.auth.userId, app.id, input);
    res.status(201).json({ document: doc });
  }));

  router.delete('/seller/application/documents/:id', limits.userWrites, asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthorized();
    await deps.sellers.removeDocument(req.auth.userId, parseOrThrow(uuidSchema, req.params.id));
    res.status(204).end();
  }));

  router.get('/seller/store', asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthorized();
    const store = await deps.sellers.getMyStore(req.auth.userId);
    if (!store) throw notFound('You do not have a store');
    res.json({ store });
  }));

  router.put('/seller/store', limits.userWrites, asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthorized();
    const input = parseOrThrow(storeProfileSchema, req.body);
    res.json({ store: await deps.sellers.updateMyStore(req.auth.userId, input) });
  }));

  router.post('/seller/store/media', limits.userWrites, asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthorized();
    const { kind, path } = parseOrThrow(mediaSchema, req.body);
    const store = await deps.sellers.getMyStore(req.auth.userId);
    if (!store) throw forbidden('Seller account required');
    const expected = new RegExp(`^${store.sellerId}/${kind}-[0-9a-f-]{36}\\.(jpg|png|webp)$`);
    if (!expected.test(path)) throw badRequest('Invalid file location');
    if (!(await deps.sellers.objectExists('store-media', path))) throw badRequest('The uploaded file was not found');
    res.json({ store: await deps.sellers.setStoreMedia(req.auth.userId, kind, path) });
  }));

  router.get('/me/follows', asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthorized();
    res.json({ slugs: await deps.sellers.listFollowedSlugs(req.auth.userId) });
  }));

  router.post('/stores/:slug/follow', limits.userWrites, asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthorized();
    await deps.sellers.follow(req.auth.userId, parseOrThrow(storeSlugSchema, req.params.slug));
    res.status(204).end();
  }));

  router.delete('/stores/:slug/follow', limits.userWrites, asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthorized();
    await deps.sellers.unfollow(req.auth.userId, parseOrThrow(storeSlugSchema, req.params.slug));
    res.status(204).end();
  }));

  return router;
}
