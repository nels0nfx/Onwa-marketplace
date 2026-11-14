import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  ORDER_ACTIONS, ORDER_ACTION_RULES, PHYSICAL_STATUSES, ORDER_STATUSES, addToCartSchema, availableOrderActions, cartQuantitySchema,
  checkoutSchema, formatOrderNumber, nextOrderStatus, orderActionSchema, listOrdersQuerySchema, RETURN_WINDOW_DAYS,
} from './orders.js';

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(resolve(here, '../../../supabase/migrations/0013_commerce.sql'), 'utf8');

test('SQL statuses and actions match TypeScript', () => {
  for (const s of [...PHYSICAL_STATUSES, ...ORDER_STATUSES]) assert.ok(sql.includes(`'${s}'`), `status ${s}`);
  for (const a of ORDER_ACTIONS) assert.ok(sql.includes(`p_action = '${a}'`), `action ${a}`);
  assert.ok(sql.includes("interval '30 minutes'"), 'reservation window parity');
  assert.ok(sql.includes("interval '7 days'"), 'return window parity');
  for (const a of ORDER_ACTIONS) {
    const r = ORDER_ACTION_RULES[a];
    assert.ok(sql.includes(`v_from := '${r.from}'; v_to := '${r.to}'`), `transition ${a}`);
  }
});

test('happy path: buyer pays (system), seller fulfils, buyer confirms', () => {
  const seq: [string, 'buyer' | 'seller', string][] = [
    ['paid', 'seller', 'start_processing'], ['processing', 'seller', 'mark_ready'], ['ready_for_dispatch', 'seller', 'dispatch'],
    ['dispatched', 'seller', 'mark_in_transit'], ['in_transit', 'seller', 'mark_delivered'], ['delivered', 'buyer', 'confirm_received'],
  ];
  for (const [from, who, action] of seq) {
    const r = nextOrderStatus(from as never, action as never, [who]);
    assert.equal(r.allowed, true, `${from}/${action}`);
  }
});

test('cancel is only for unpaid orders, by buyer or staff', () => {
  assert.equal(nextOrderStatus('pending_payment', 'cancel', ['buyer']).allowed, true);
  assert.equal(nextOrderStatus('pending_payment', 'cancel', ['staff']).allowed, true);
  assert.equal(nextOrderStatus('pending_payment', 'cancel', ['seller']).allowed, false);
  for (const s of PHYSICAL_STATUSES.filter((x) => x !== 'pending_payment')) assert.equal(nextOrderStatus(s, 'cancel', ['buyer', 'staff']).allowed, false, s);
});

test('actors are enforced: buyers cannot fulfil, sellers cannot confirm receipt or return', () => {
  assert.equal(nextOrderStatus('paid', 'start_processing', ['buyer']).allowed, false);
  assert.equal(nextOrderStatus('delivered', 'confirm_received', ['seller']).allowed, false);
  assert.equal(nextOrderStatus('delivered', 'request_return', ['seller']).allowed, false);
  assert.equal(nextOrderStatus('delivered', 'request_return', ['staff'], { deliveredAt: new Date() }).allowed, false);
});

test('steps cannot be skipped or repeated', () => {
  assert.equal(nextOrderStatus('paid', 'dispatch', ['seller']).allowed, false);
  assert.equal(nextOrderStatus('processing', 'start_processing', ['seller']).allowed, false);
  assert.equal(nextOrderStatus('completed', 'confirm_received', ['buyer']).allowed, false);
  assert.equal(nextOrderStatus('cancelled', 'start_processing', ['seller']).allowed, false);
});

test('return window', () => {
  const now = new Date('2026-06-15T12:00:00Z');
  const day = 86_400_000;
  assert.equal(nextOrderStatus('delivered', 'request_return', ['buyer'], { deliveredAt: new Date(now.getTime() - 2 * day), now }).allowed, true);
  assert.equal(nextOrderStatus('delivered', 'request_return', ['buyer'], { deliveredAt: new Date(now.getTime() - (RETURN_WINDOW_DAYS + 1) * day), now }).allowed, false);
  assert.equal(nextOrderStatus('delivered', 'request_return', ['buyer'], { deliveredAt: null, now }).allowed, false);
});

test('payment confirmation and refunds are not user actions', () => {
  assert.ok(!(ORDER_ACTIONS as readonly string[]).includes('mark_paid'));
  for (const to of ['paid', 'returned', 'refund_pending', 'refunded']) {
    assert.ok(!ORDER_ACTIONS.some((a) => ORDER_ACTION_RULES[a].to === to), `${to} must not be reachable by a user action`);
  }
});

test('availableOrderActions per viewer', () => {
  assert.deepEqual(availableOrderActions('pending_payment', ['buyer']), ['cancel']);
  assert.deepEqual(availableOrderActions('pending_payment', ['seller']), []);
  assert.deepEqual(availableOrderActions('paid', ['seller']), ['start_processing']);
  assert.deepEqual(availableOrderActions('delivered', ['buyer'], { deliveredAt: new Date() }).sort(), ['confirm_received', 'request_return']);
  assert.deepEqual(availableOrderActions('completed', ['buyer', 'seller', 'staff']), []);
});

test('cart and checkout schemas', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  assert.equal(addToCartSchema.safeParse({ variantId: id, quantity: 2 }).success, true);
  assert.equal(addToCartSchema.safeParse({ variantId: id, quantity: 0 }).success, false);
  assert.equal(addToCartSchema.safeParse({ variantId: id, quantity: 100 }).success, false);
  assert.equal(addToCartSchema.safeParse({ variantId: id, quantity: 1.5 }).success, false);
  assert.equal(addToCartSchema.safeParse({ variantId: id, quantity: 1, price: 1 }).success, false, 'clients cannot send prices');
  assert.equal(cartQuantitySchema.safeParse({ quantity: 5 }).success, true);
  const ok = { storeSlug: 'amaka-crafts', addressId: id, idempotencyKey: id };
  assert.equal(checkoutSchema.safeParse(ok).success, true);
  assert.equal(checkoutSchema.safeParse({ ...ok, note: '' }).success, true);
  assert.equal(checkoutSchema.safeParse({ ...ok, note: 'x'.repeat(301) }).success, false);
  assert.equal(checkoutSchema.safeParse({ ...ok, totalKobo: 1 }).success, false);
  assert.equal(checkoutSchema.safeParse({ ...ok, idempotencyKey: 'abc' }).success, false);
  assert.equal(orderActionSchema.safeParse({ action: 'cancel' }).success, true);
  assert.equal(orderActionSchema.safeParse({ action: 'mark_paid' }).success, false);
  assert.equal(listOrdersQuerySchema.parse({}).limit, 20);
  assert.equal(listOrdersQuerySchema.safeParse({ status: 'weird' }).success, false);
  assert.equal(formatOrderNumber(100001), 'ONWA-100001');
});
