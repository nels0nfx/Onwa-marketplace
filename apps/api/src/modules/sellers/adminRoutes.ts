import { Router } from 'express';
import type { RequestHandler } from 'express';
import {
  listApplicationsQuerySchema, listAuditQuerySchema, reviewDecisionSchema, sellerStatusChangeSchema, uuidSchema,
} from '@onwa/shared';
import type { AppDeps } from '../../deps.js';
import { notFound, unauthorized } from '../../lib/errors.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { parseOrThrow } from '../../middleware/validate.js';

export function sellerAdminRoutes(deps: Pick<AppDeps, 'sellers'>, limits: { adminWrites: RequestHandler }): Router {
  const router = Router();

  router.get('/admin/seller-applications', requirePermission('sellers.read'), asyncHandler(async (req, res) => {
    const q = parseOrThrow(listApplicationsQuerySchema, req.query);
    res.json(await deps.sellers.listApplications({ ...(q.status ? { status: q.status } : {}), limit: q.limit, offset: q.offset }));
  }));

  router.get('/admin/seller-applications/:id', requirePermission('sellers.read'), asyncHandler(async (req, res) => {
    const detail = await deps.sellers.getApplicationDetail(parseOrThrow(uuidSchema, req.params.id));
    if (!detail) throw notFound('Application not found');
    res.json({ application: detail });
  }));

  router.post('/admin/seller-applications/:id/decision', requirePermission('sellers.review'), limits.adminWrites, asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthorized();
    const id = parseOrThrow(uuidSchema, req.params.id);
    const { decision, note } = parseOrThrow(reviewDecisionSchema, req.body);
    await deps.sellers.reviewApplication(req.auth.userId, id, decision, note);
    res.status(204).end();
  }));

  router.get('/admin/sellers', requirePermission('sellers.read'), asyncHandler(async (req, res) => {
    const q = parseOrThrow(listAuditQuerySchema, req.query);
    res.json(await deps.sellers.listSellers(q));
  }));

  router.post('/admin/sellers/:id/status', requirePermission('sellers.manage'), limits.adminWrites, asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthorized();
    const id = parseOrThrow(uuidSchema, req.params.id);
    const { status, note } = parseOrThrow(sellerStatusChangeSchema, req.body);
    await deps.sellers.setSellerStatus(req.auth.userId, id, status, note);
    res.status(204).end();
  }));

  return router;
}
