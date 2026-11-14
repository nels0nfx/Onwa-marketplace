import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from './app.js';
import { makeDeps, testConfig } from './test-helpers.js';

const deps = makeDeps();
const server: Server = createApp(deps, testConfig).listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
after(() => new Promise<void>((r) => server.close(() => r())));

async function call(path: string, init: { method?: string; token?: string; body?: unknown } = {}) {
  const res = await fetch(`${base}${path}`, {
    method: init.method ?? 'GET',
    headers: { ...(init.token ? { authorization: `Bearer ${init.token}` } : {}), ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: text ? (JSON.parse(text) as Record<string, any>) : null };
}

const VARIANT = '90000000-0000-4000-8000-000000000001';
const ADDRESS = '10000000-0000-4000-8000-000000000001';
const KEY = '33333333-3333-4333-8333-333333333333';
const checkout = { storeSlug: 'amaka-crafts', addressId: ADDRESS, idempotencyKey: KEY };

describe('cart', () => {
  test('requires sign-in', async () => {
    assert.equal((await call('/cart')).status, 401);
    assert.equal((await call('/cart/items', { method: 'POST', body: { variantId: VARIANT, quantity: 1 } })).status, 401);
  });
  test('validates input and refuses client-supplied prices', async () => {
    const add = (body: object) => call('/cart/items', { method: 'POST', token: 'tok-alice', body });
    assert.equal((await add({ variantId: VARIANT, quantity: 0 })).status, 400);
    assert.equal((await add({ variantId: VARIANT, quantity: 100 })).status, 400);
    assert.equal((await add({ variantId: 'nope', quantity: 1 })).status, 400);
    assert.equal((await add({ variantId: VARIANT, quantity: 1, priceKobo: 1 })).status, 400);
    assert.equal((await add({ variantId: VARIANT, quantity: 1, unitPriceKobo: 1 })).status, 400);
  });
  test('add, stock limit, update, remove; carts are per user', async () => {
    assert.equal((await call('/cart/items', { method: 'POST', token: 'tok-alice', body: { variantId: VARIANT, quantity: 2 } })).status, 204);
    assert.equal((await call('/cart/items', { method: 'POST', token: 'tok-alice', body: { variantId: VARIANT, quantity: 4 } })).status, 409, 'exceeds stock');
    const cart = await call('/cart', { token: 'tok-alice' });
    assert.equal(cart.json?.itemCount, 2);
    assert.equal((await call('/cart', { token: 'tok-bob' })).json?.itemCount, 0);
    const itemId = cart.json?.groups[0].items[0].id as string;
    assert.equal((await call(`/cart/items/${itemId}`, { method: 'PUT', token: 'tok-bob', body: { quantity: 1 } })).status, 404, 'cannot touch another user\'s line');
    assert.equal((await call(`/cart/items/${itemId}`, { method: 'PUT', token: 'tok-alice', body: { quantity: 3 } })).status, 204);
    assert.equal((await call(`/cart/items/${itemId}`, { method: 'PUT', token: 'tok-alice', body: { quantity: 0 } })).status, 400);
    assert.equal((await call(`/cart/items/${itemId}`, { method: 'DELETE', token: 'tok-bob' })).status, 204);
    assert.equal((await call('/cart', { token: 'tok-alice' })).json?.itemCount, 3, 'bob\'s delete did nothing to alice');
  });
});

describe('checkout', () => {
  test('validates body: needs idempotency key and address, rejects totals from the client', async () => {
    const post = (body: object) => call('/checkout', { method: 'POST', token: 'tok-alice', body });
    assert.equal((await post({ storeSlug: 'amaka-crafts', addressId: ADDRESS })).status, 400);
    assert.equal((await post({ ...checkout, idempotencyKey: 'abc' })).status, 400);
    assert.equal((await post({ ...checkout, totalKobo: 1 })).status, 400);
    assert.equal((await post({ ...checkout, note: 'x'.repeat(301) })).status, 400);
    assert.equal((await call('/checkout', { method: 'POST', body: checkout })).status, 401);
  });
  let orderId = '';
  test('places an order, reserves stock, and the same key never creates a second order', async () => {
    const stockBefore = deps.orders.stock.get(VARIANT);
    const first = await call('/checkout', { method: 'POST', token: 'tok-alice', body: checkout });
    assert.equal(first.status, 201);
    orderId = first.json?.orderId as string;
    assert.equal(deps.orders.stock.get(VARIANT), (stockBefore ?? 0) - 3);
    const second = await call('/checkout', { method: 'POST', token: 'tok-alice', body: checkout });
    assert.equal(second.json?.orderId, orderId);
    assert.equal(deps.orders.orders.size, 1);
    assert.ok(deps.orders.swept >= 1, 'expired reservations are released at checkout');
  });
  test('the buyer sees the order; other users do not', async () => {
    assert.equal((await call(`/orders/${orderId}`, { token: 'tok-alice' })).status, 200);
    assert.equal((await call(`/orders/${orderId}`, { token: 'tok-bob' })).status, 404);
    assert.equal(((await call('/orders', { token: 'tok-alice' })).json?.rows as unknown[]).length, 1);
    assert.equal(((await call('/orders', { token: 'tok-bob' })).json?.rows as unknown[]).length, 0);
    assert.equal((await call('/orders/not-a-uuid', { token: 'tok-alice' })).status, 400);
  });
});

describe('order actions', () => {
  const subId = () => [...deps.orders.subs.keys()][0] as string;
  test('payment cannot be confirmed through the API', async () => {
    for (const action of ['mark_paid', 'paid', 'refund', 'refunded', 'returned']) {
      assert.equal((await call(`/suborders/${subId()}/action`, { method: 'POST', token: 'tok-alice', body: { action } })).status, 400, action);
    }
    assert.equal(deps.orders.subs.get(subId())?.status, 'pending_payment');
  });
  test('only the right actor can act; strangers get 404; the seller cannot cancel an unpaid order', async () => {
    const act = (token: string, action: string) => call(`/suborders/${subId()}/action`, { method: 'POST', token, body: { action } });
    assert.equal((await act('tok-bob', 'cancel')).status, 404);
    assert.equal((await act('tok-seller', 'cancel')).status, 403, 'a seller may never cancel on the buyer\'s behalf');
    assert.equal((await act('tok-alice', 'start_processing')).status, 403, 'buyers cannot fulfil');
    assert.equal((await act('tok-alice', 'confirm_received')).status, 409, 'allowed actor, wrong state');
  });
  test('buyer cancel returns stock; second cancel conflicts', async () => {
    const before = deps.orders.stock.get(VARIANT) ?? 0;
    assert.equal((await call(`/suborders/${subId()}/action`, { method: 'POST', token: 'tok-alice', body: { action: 'cancel' } })).status, 204);
    assert.equal(deps.orders.stock.get(VARIANT), before + 3);
    assert.equal((await call(`/suborders/${subId()}/action`, { method: 'POST', token: 'tok-alice', body: { action: 'cancel' } })).status, 409);
  });
  test('seller fulfilment flow on a paid order, and sellers see paid orders only', async () => {
    const paid = [...deps.orders.subs.values()][0]!;
    assert.equal((await call('/seller/orders', { token: 'tok-seller' })).json?.rows.length, 0, 'unpaid/cancelled orders are invisible to sellers');
    // simulate the Stage 5 webhook flipping the order to paid
    paid.status = 'paid'; paid.paid = true;
    assert.equal((await call('/seller/orders', { token: 'tok-seller' })).json?.rows.length, 1);
    const detail = await call(`/seller/orders/${paid.id}`, { token: 'tok-seller' });
    assert.equal(detail.status, 200);
    assert.deepEqual(detail.json?.order.actions, ['start_processing']);
    assert.equal((await call(`/seller/orders/${paid.id}`, { token: 'tok-alice' })).status, 403, 'non-sellers are refused');
    const step = (action: string) => call(`/suborders/${paid.id}/action`, { method: 'POST', token: 'tok-seller', body: { action } });
    assert.equal((await step('dispatch')).status, 409, 'cannot skip steps');
    for (const a of ['start_processing', 'mark_ready', 'dispatch', 'mark_in_transit', 'mark_delivered']) assert.equal((await step(a)).status, 204, a);
    assert.equal((await step('confirm_received')).status, 403, 'only the buyer confirms receipt');
    assert.equal((await call(`/suborders/${paid.id}/action`, { method: 'POST', token: 'tok-alice', body: { action: 'confirm_received' } })).status, 204);
    assert.equal(paid.status, 'completed');
  });
});

describe('staff orders', () => {
  test('listing needs orders.read; the expiry sweep needs orders.manage', async () => {
    assert.equal((await call('/admin/orders', { token: 'tok-alice' })).status, 403);
    assert.equal((await call('/admin/orders', { token: 'tok-seller' })).status, 403);
    assert.equal((await call('/admin/orders', { token: 'tok-erin' })).status, 200, 'support can read orders');
    assert.equal((await call('/admin/orders/expire-unpaid', { method: 'POST', token: 'tok-erin' })).status, 403, 'support cannot manage');
    assert.equal((await call('/admin/orders/expire-unpaid', { method: 'POST', token: 'tok-ops' })).status, 200);
    assert.equal((await call('/admin/orders', { token: 'tok-ops' })).status, 200);
    assert.equal((await call('/admin/orders?status=weird', { token: 'tok-ops' })).status, 400);
  });
});
