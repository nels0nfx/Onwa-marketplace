import { Router } from 'express';
import type { Request, RequestHandler } from 'express';
import {
  addToCartSchema, cartQuantitySchema, checkoutSchema, listOrdersQuerySchema, orderActionSchema, uuidSchema, ORDER_STATUSES, PHYSICAL_STATUSES,
} from '@onwa/shared';
import { z } from 'zod';
import type { AppDeps } from '../../deps.js';
import { forbidden, unauthorized } from '../../lib/errors.js';
import { notFound } from '../../lib/errors.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { parseOrThrow } from '../../middleware/validate.js';

const sellerOrdersQuery = z.object({
  status: z.enum(PHYSICAL_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});
const adminOrdersQuery = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});

/** Cart, checkout and the signed-in buyer's own orders. Every query is scoped to req.auth.userId. */
export function orderRoutes(deps: Pick<AppDeps, 'orders' | 'sellers'>, limits: { userWrites: RequestHandler }): Router {
  const router = Router();
  const user = (req: Request): string => { if (!req.auth) throw unauthorized(); return req.auth.userId; };
  /** Releases stock held by unpaid orders whose window has passed. Failure must never block the request. */
  const sweep = async () => { try { await deps.orders.expireUnpaid(); } catch { /* best effort */ } };

  router.get('/cart', asyncHandler(async (req, res) => { res.json(await deps.orders.getCart(user(req))); }));

  router.post('/cart/items', limits.userWrites, asyncHandler(async (req, res) => {
    const input = parseOrThrow(addToCartSchema, req.body);
    await deps.orders.addToCart(user(req), input.variantId, input.quantity);
    res.status(204).end();
  }));

  router.put('/cart/items/:id', limits.userWrites, asyncHandler(async (req, res) => {
    const uid = user(req);
    await deps.orders.setCartQuantity(uid, parseOrThrow(uuidSchema, req.params.id), parseOrThrow(cartQuantitySchema, req.body).quantity);
    res.status(204).end();
  }));

  router.delete('/cart/items/:id', limits.userWrites, asyncHandler(async (req, res) => {
    await deps.orders.removeCartItem(user(req), parseOrThrow(uuidSchema, req.params.id));
    res.status(204).end();
  }));

  router.post('/checkout', limits.userWrites, asyncHandler(async (req, res) => {
    const uid = user(req);
    const input = parseOrThrow(checkoutSchema, req.body);
    await sweep();
    const orderId = await deps.orders.createOrder(uid, input.storeSlug, input.addressId, input.note, input.idempotencyKey);
    res.status(201).json({ orderId });
  }));

  router.get('/orders', asyncHandler(async (req, res) => {
    const uid = user(req);
    await sweep();
    res.json(await deps.orders.listOrders(uid, parseOrThrow(listOrdersQuerySchema.pick({ limit: true, offset: true }), req.query)));
  }));

  router.get('/orders/:id', asyncHandler(async (req, res) => {
    const uid = user(req);
    await sweep();
    const order = await deps.orders.getOrder(uid, parseOrThrow(uuidSchema, req.params.id));
    if (!order) throw notFound('Order not found');
    res.json({ order });
  }));

  /**
   * One endpoint for every actor (buyer, seller, staff). Who may do what is decided by the database function
   * and mirrored by the shared state machine; the client never chooses a target status.
   */
  router.post('/suborders/:id/action', limits.userWrites, asyncHandler(async (req, res) => {
    const uid = user(req);
    const id = parseOrThrow(uuidSchema, req.params.id);
    const { action, note } = parseOrThrow(orderActionSchema, req.body);
    await deps.orders.changeStatus(uid, id, action, note);
    res.status(204).end();
  }));

  // ---- seller view: paid orders of the authenticated seller only
  async function sellerId(req: Request): Promise<string> {
    const store = await deps.sellers.getMyStore(user(req));
    if (!store) throw forbidden('Seller account required');
    return store.sellerId;
  }

  router.get('/seller/orders', asyncHandler(async (req, res) => {
    const sid = await sellerId(req);
    const q = parseOrThrow(sellerOrdersQuery, req.query);
    res.json(await deps.orders.listSellerOrders(sid, { ...(q.status ? { status: q.status } : {}), limit: q.limit, offset: q.offset }));
  }));

  router.get('/seller/orders/:id', asyncHandler(async (req, res) => {
    const sid = await sellerId(req);
    const order = await deps.orders.getSellerOrder(sid, parseOrThrow(uuidSchema, req.params.id));
    if (!order) throw notFound('Order not found');
    res.json({ order });
  }));

  return router;
}

export function adminOrderRoutes(deps: Pick<AppDeps, 'orders'>, limits: { adminWrites: RequestHandler }): Router {
  const router = Router();

  router.get('/admin/orders', requirePermission('orders.read'), asyncHandler(async (req, res) => {
    const q = parseOrThrow(adminOrdersQuery, req.query);
    res.json(await deps.orders.listAdminOrders({ ...(q.status ? { status: q.status } : {}), limit: q.limit, offset: q.offset }));
  }));

  router.get('/admin/orders/:id', requirePermission('orders.read'), asyncHandler(async (req, res) => {
    const order = await deps.orders.getAdminOrder(parseOrThrow(uuidSchema, req.params.id));
    if (!order) throw notFound('Order not found');
    res.json({ order });
  }));

  router.post('/admin/orders/expire-unpaid', requirePermission('orders.manage'), limits.adminWrites, asyncHandler(async (_req, res) => {
    res.json({ cancelled: await deps.orders.expireUnpaid() });
  }));

  return router;
}
