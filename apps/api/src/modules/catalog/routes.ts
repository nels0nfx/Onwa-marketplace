import { Router } from 'express';
import type { Request, RequestHandler } from 'express';
import { z } from 'zod';
import {
  addVariantSchema, browseProductsQuerySchema, categoryCreateSchema, categoryUpdateSchema, createProductSchema, imageRecordSchema,
  listProductsQuerySchema, productActionSchema, productDecisionSchema, productSlugSchema, productUpdateSchema, stockAdjustSchema,
  updateVariantSchema, uuidSchema,
} from '@onwa/shared';
import type { AppDeps } from '../../deps.js';
import { badRequest, forbidden, notFound, unauthorized } from '../../lib/errors.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { parseOrThrow } from '../../middleware/validate.js';

const movementsQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) });

/** Public catalogue reads. Only approved products of active sellers are ever returned. */
export function publicCatalogRoutes(deps: Pick<AppDeps, 'catalog'>): Router {
  const router = Router();
  router.get('/categories', asyncHandler(async (_req, res) => { res.json({ categories: await deps.catalog.listCategories() }); }));
  router.get('/products', asyncHandler(async (req, res) => {
    res.json(await deps.catalog.browseProducts(parseOrThrow(browseProductsQuerySchema, req.query)));
  }));
  router.get('/products/:slug', asyncHandler(async (req, res) => {
    const product = await deps.catalog.getPublicProduct(parseOrThrow(productSlugSchema, req.params.slug));
    if (!product) throw notFound('Product not found');
    res.json({ product });
  }));
  return router;
}

export function sellerCatalogRoutes(deps: Pick<AppDeps, 'catalog' | 'sellers'>, limits: { userWrites: RequestHandler }): Router {
  const router = Router();

  /** The seller id always comes from the authenticated user, never from the request. */
  async function sellerId(req: Request): Promise<string> {
    if (!req.auth) throw unauthorized();
    const store = await deps.sellers.getMyStore(req.auth.userId);
    if (!store) throw forbidden('Seller account required');
    return store.sellerId;
  }

  router.get('/seller/products', asyncHandler(async (req, res) => {
    const q = parseOrThrow(listProductsQuerySchema, req.query);
    res.json(await deps.catalog.listMyProducts(await sellerId(req), { ...(q.status ? { status: q.status } : {}), limit: q.limit, offset: q.offset }));
  }));

  router.post('/seller/products', limits.userWrites, asyncHandler(async (req, res) => {
    const sid = await sellerId(req);
    const input = parseOrThrow(createProductSchema, req.body);
    const id = await deps.catalog.createProduct(sid, input);
    res.status(201).json({ id });
  }));

  router.get('/seller/products/:id', asyncHandler(async (req, res) => {
    const product = await deps.catalog.getMyProduct(await sellerId(req), parseOrThrow(uuidSchema, req.params.id));
    if (!product) throw notFound('Product not found');
    res.json({ product });
  }));

  router.put('/seller/products/:id', limits.userWrites, asyncHandler(async (req, res) => {
    const sid = await sellerId(req);
    const id = parseOrThrow(uuidSchema, req.params.id);
    res.json({ product: await deps.catalog.updateProduct(sid, id, parseOrThrow(productUpdateSchema, req.body)) });
  }));

  router.post('/seller/products/:id/status', limits.userWrites, asyncHandler(async (req, res) => {
    const sid = await sellerId(req);
    const id = parseOrThrow(uuidSchema, req.params.id);
    const { action } = parseOrThrow(productActionSchema, req.body);
    await deps.catalog.changeProductStatus(sid, id, action);
    res.status(204).end();
  }));

  router.post('/seller/products/:id/variants', limits.userWrites, asyncHandler(async (req, res) => {
    const sid = await sellerId(req);
    const id = parseOrThrow(uuidSchema, req.params.id);
    res.status(201).json({ id: await deps.catalog.addVariant(sid, id, parseOrThrow(addVariantSchema, req.body)) });
  }));

  router.put('/seller/variants/:id', limits.userWrites, asyncHandler(async (req, res) => {
    const sid = await sellerId(req);
    await deps.catalog.updateVariant(sid, parseOrThrow(uuidSchema, req.params.id), parseOrThrow(updateVariantSchema, req.body));
    res.status(204).end();
  }));

  router.post('/seller/variants/:id/stock', limits.userWrites, asyncHandler(async (req, res) => {
    const sid = await sellerId(req);
    const body = parseOrThrow(stockAdjustSchema, req.body);
    const quantity = await deps.catalog.adjustStock(sid, parseOrThrow(uuidSchema, req.params.id), body.delta, body.reason, body.note);
    res.json({ quantity });
  }));

  router.get('/seller/products/:id/movements', asyncHandler(async (req, res) => {
    const sid = await sellerId(req);
    const { limit } = parseOrThrow(movementsQuery, req.query);
    res.json({ movements: await deps.catalog.listMovements(sid, parseOrThrow(uuidSchema, req.params.id), limit) });
  }));

  router.post('/seller/products/:id/images', limits.userWrites, asyncHandler(async (req, res) => {
    const sid = await sellerId(req);
    const productId = parseOrThrow(uuidSchema, req.params.id);
    const { path, altText } = parseOrThrow(imageRecordSchema, req.body);
    // Files must live in this seller's folder for this product, with a generated name.
    if (!new RegExp(`^${sid}/${productId}/[0-9a-f-]{36}\\.(jpg|png|webp)$`).test(path)) throw badRequest('Invalid file location');
    if (!(await deps.sellers.objectExists('product-media', path))) throw badRequest('The uploaded file was not found');
    res.status(201).json({ image: await deps.catalog.addImage(sid, productId, path, altText) });
  }));

  router.delete('/seller/products/:id/images/:imageId', limits.userWrites, asyncHandler(async (req, res) => {
    const sid = await sellerId(req);
    await deps.catalog.removeImage(sid, parseOrThrow(uuidSchema, req.params.id), parseOrThrow(uuidSchema, req.params.imageId));
    res.status(204).end();
  }));

  return router;
}

export function adminCatalogRoutes(deps: Pick<AppDeps, 'catalog'>, limits: { adminWrites: RequestHandler }): Router {
  const router = Router();

  router.get('/admin/products', requirePermission('catalog.moderate'), asyncHandler(async (req, res) => {
    const q = parseOrThrow(listProductsQuerySchema, req.query);
    res.json(await deps.catalog.listAdminProducts({ ...(q.status ? { status: q.status } : {}), limit: q.limit, offset: q.offset }));
  }));

  router.get('/admin/products/:id', requirePermission('catalog.moderate'), asyncHandler(async (req, res) => {
    const product = await deps.catalog.getAdminProduct(parseOrThrow(uuidSchema, req.params.id));
    if (!product) throw notFound('Product not found');
    res.json({ product });
  }));

  router.post('/admin/products/:id/decision', requirePermission('catalog.moderate'), limits.adminWrites, asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthorized();
    const id = parseOrThrow(uuidSchema, req.params.id);
    const { decision, note } = parseOrThrow(productDecisionSchema, req.body);
    await deps.catalog.reviewProduct(req.auth.userId, id, decision, note);
    res.status(204).end();
  }));

  router.get('/admin/categories', requirePermission('categories.manage'), asyncHandler(async (_req, res) => {
    res.json({ categories: await deps.catalog.listAdminCategories() });
  }));

  router.post('/admin/categories', requirePermission('categories.manage'), limits.adminWrites, asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthorized();
    const input = parseOrThrow(categoryCreateSchema, req.body);
    res.status(201).json({ id: await deps.catalog.createCategory(req.auth.userId, input.name, input.parentId, input.sortOrder) });
  }));

  router.put('/admin/categories/:id', requirePermission('categories.manage'), limits.adminWrites, asyncHandler(async (req, res) => {
    if (!req.auth) throw unauthorized();
    await deps.catalog.updateCategory(req.auth.userId, parseOrThrow(uuidSchema, req.params.id), parseOrThrow(categoryUpdateSchema, req.body));
    res.status(204).end();
  }));

  return router;
}
