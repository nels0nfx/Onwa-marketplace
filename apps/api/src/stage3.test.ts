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

const SELLER = '20000000-0000-4000-8000-000000000001';
const live = deps.catalog.seed({ slug: 'live-bag', status: 'approved' });
const draft = deps.catalog.seed({ slug: 'draft-bag', status: 'draft' });
const hiddenSeller = deps.catalog.seed({ slug: 'suspended-bag', status: 'approved', sellerActive: false });
const pending = deps.catalog.seed({ slug: 'pending-bag', status: 'pending_review' });
const otherSellers = deps.catalog.seed({ slug: 'others-bag', status: 'draft', sellerId: '20000000-0000-4000-8000-000000000999' });
const newProduct = { name: 'Beaded Necklace', condition: 'new', variants: [{ priceKobo: 250000, initialStock: 3 }] };

describe('public catalogue', () => {
  test('lists only approved products of active sellers', async () => {
    const r = await call('/products');
    assert.equal(r.status, 200);
    assert.deepEqual((r.json?.rows as { slug: string }[]).map((p) => p.slug), ['live-bag']);
  });
  test('detail is served only for live products and exposes no stock numbers or SKUs', async () => {
    const ok = await call('/products/live-bag');
    assert.equal(ok.status, 200);
    const v = ok.json?.product.variants[0];
    assert.deepEqual(Object.keys(v).sort(), ['id', 'inStock', 'lowStock', 'optionValues', 'priceKobo', 'salePriceKobo']);
    for (const slug of ['draft-bag', 'pending-bag', 'suspended-bag', 'nope-nope']) assert.equal((await call(`/products/${slug}`)).status, 404, slug);
    assert.equal((await call('/products/Bad_Slug!')).status, 400);
  });
  test('browse query is validated', async () => {
    assert.equal((await call('/products?limit=500')).status, 400);
    assert.equal((await call('/products?sort=random')).status, 400);
    assert.equal((await call('/products?q=bag&sort=price_asc&inStock=1')).status, 200);
  });
  test('categories are public', async () => {
    assert.equal((await call('/categories')).status, 200);
  });
});

describe('seller product management', () => {
  test('non-sellers are refused', async () => {
    assert.equal((await call('/seller/products', { token: 'tok-alice' })).status, 403);
    assert.equal((await call('/seller/products', { method: 'POST', token: 'tok-alice', body: newProduct })).status, 403);
    assert.equal((await call('/seller/products')).status, 401);
  });
  test('sellers see only their own products', async () => {
    const r = await call('/seller/products', { token: 'tok-seller' });
    const slugs = (r.json?.rows as { slug: string }[]).map((p) => p.slug);
    assert.ok(slugs.includes('draft-bag'));
    assert.ok(!slugs.includes('others-bag'));
    assert.equal((await call(`/seller/products/${otherSellers.id}`, { token: 'tok-seller' })).status, 404);
    assert.equal((await call(`/seller/products/${otherSellers.id}`, { method: 'PUT', token: 'tok-seller', body: { name: 'Hijacked', condition: 'new' } })).status, 404);
    assert.equal((await call(`/seller/products/${otherSellers.id}/status`, { method: 'POST', token: 'tok-seller', body: { action: 'archive' } })).status, 404);
  });
  test('create validates input; status and seller id cannot be smuggled; seller id comes from the session', async () => {
    assert.equal((await call('/seller/products', { method: 'POST', token: 'tok-seller', body: { ...newProduct, status: 'approved' } })).status, 400);
    assert.equal((await call('/seller/products', { method: 'POST', token: 'tok-seller', body: { ...newProduct, sellerId: 'x' } })).status, 400);
    assert.equal((await call('/seller/products', { method: 'POST', token: 'tok-seller', body: { ...newProduct, variants: [{ priceKobo: 1.5 }] } })).status, 400);
    assert.equal((await call('/seller/products', { method: 'POST', token: 'tok-seller', body: { ...newProduct, variants: [{ priceKobo: 0 }] } })).status, 400);
    const ok = await call('/seller/products', { method: 'POST', token: 'tok-seller', body: newProduct });
    assert.equal(ok.status, 201);
    const created = deps.catalog.calls.filter((c) => c.fn === 'createProduct').at(-1);
    assert.equal(created?.args[0], SELLER);
  });
  test('status workflow: submit needs completeness; approved listings cannot be re-submitted; editing during review is blocked', async () => {
    const incomplete = deps.catalog.seed({ slug: 'no-image', status: 'draft', images: [] });
    assert.equal((await call(`/seller/products/${incomplete.id}/status`, { method: 'POST', token: 'tok-seller', body: { action: 'submit' } })).status, 400);
    assert.equal((await call(`/seller/products/${draft.id}/status`, { method: 'POST', token: 'tok-seller', body: { action: 'submit' } })).status, 204);
    assert.equal(deps.catalog.products.get(draft.id)?.status, 'pending_review');
    assert.equal((await call(`/seller/products/${draft.id}`, { method: 'PUT', token: 'tok-seller', body: { name: 'Edited Name', condition: 'new' } })).status, 409);
    assert.equal((await call(`/seller/products/${live.id}/status`, { method: 'POST', token: 'tok-seller', body: { action: 'submit' } })).status, 409);
    assert.equal((await call(`/seller/products/${draft.id}/status`, { method: 'POST', token: 'tok-seller', body: { action: 'bogus' } })).status, 400);
    assert.equal((await call(`/seller/products/${draft.id}/status`, { method: 'POST', token: 'tok-seller', body: { action: 'withdraw' } })).status, 204);
  });
  test('editing a live listing sends it back to review (it leaves the catalogue)', async () => {
    assert.equal((await call(`/seller/products/${live.id}`, { method: 'PUT', token: 'tok-seller', body: { name: 'Renamed Bag', condition: 'new' } })).status, 200);
    assert.equal(deps.catalog.products.get(live.id)?.status, 'pending_review');
    assert.equal((await call('/products/live-bag')).status, 404);
    deps.catalog.products.get(live.id)!.status = 'approved';
  });
  test('stock: sellers can restock and correct, never go negative, never fake a sale', async () => {
    const v = deps.catalog.products.get(live.id)!.variants[0]!;
    const adjust = (body: object) => call(`/seller/variants/${v.id}/stock`, { method: 'POST', token: 'tok-seller', body });
    assert.equal((await adjust({ delta: 10, reason: 'restock' })).json?.quantity, 15);
    assert.equal((await adjust({ delta: -100, reason: 'correction' })).status, 409);
    assert.equal((await adjust({ delta: 5, reason: 'sale' })).status, 400);
    assert.equal((await adjust({ delta: 0, reason: 'restock' })).status, 400);
    assert.equal(deps.catalog.products.get(live.id)!.variants[0]!.stockQuantity, 15);
    // someone else's variant
    const foreign = deps.catalog.products.get(otherSellers.id)!.variants[0]!;
    assert.equal((await call(`/seller/variants/${foreign.id}/stock`, { method: 'POST', token: 'tok-seller', body: { delta: 1, reason: 'restock' } })).status, 404);
  });
  test('image paths must be inside the seller\'s own folder for that product', async () => {
    const good = `${SELLER}/${draft.id}/44444444-4444-4444-8444-444444444444.png`;
    const body = (path: string) => ({ path });
    assert.equal((await call(`/seller/products/${draft.id}/images`, { method: 'POST', token: 'tok-seller', body: body(good) })).status, 400, 'object missing');
    deps.sellers.objects.add(good);
    assert.equal((await call(`/seller/products/${draft.id}/images`, { method: 'POST', token: 'tok-seller', body: body(good) })).status, 201);
    const foreign = `20000000-0000-4000-8000-000000000999/${draft.id}/44444444-4444-4444-8444-444444444444.png`;
    deps.sellers.objects.add(foreign);
    assert.equal((await call(`/seller/products/${draft.id}/images`, { method: 'POST', token: 'tok-seller', body: body(foreign) })).status, 400);
    assert.equal((await call(`/seller/products/${draft.id}/images`, { method: 'POST', token: 'tok-seller', body: body(`${SELLER}/${draft.id}/../x.png`) })).status, 400);
    assert.equal((await call(`/seller/products/${draft.id}/images`, { method: 'POST', token: 'tok-seller', body: body(`${SELLER}/${draft.id}/shell.php`) })).status, 400);
  });
});

describe('moderation and categories', () => {
  test('only staff with catalog.moderate see the queue and decide', async () => {
    for (const token of ['tok-alice', 'tok-seller', 'tok-dave', 'tok-erin']) {
      assert.equal((await call('/admin/products', { token })).status, 403, token);
      assert.equal((await call(`/admin/products/${pending.id}/decision`, { method: 'POST', token, body: { decision: 'approve' } })).status, 403, token);
    }
    assert.equal((await call('/admin/products', { token: 'tok-manager' })).status, 200);
  });
  test('decisions follow the workflow; notes required for changes/rejection; only pending listings', async () => {
    const d = (id: string, body: object) => call(`/admin/products/${id}/decision`, { method: 'POST', token: 'tok-manager', body });
    assert.equal((await d(pending.id, { decision: 'reject' })).status, 400);
    assert.equal((await d(pending.id, { decision: 'request_changes', note: 'Add clearer photos' })).status, 204);
    assert.equal(deps.catalog.products.get(pending.id)?.status, 'changes_requested');
    assert.equal((await d(pending.id, { decision: 'approve' })).status, 409, 'no longer pending');
    assert.equal((await d(draft.id, { decision: 'approve' })).status, 409, 'drafts cannot be approved');
    assert.equal((await d('not-a-uuid', { decision: 'approve' })).status, 400);
  });
  test('category management needs categories.manage', async () => {
    assert.equal((await call('/admin/categories', { token: 'tok-manager' })).status, 403, 'seller_manager lacks categories.manage');
    assert.equal((await call('/admin/categories', { token: 'tok-carol' })).status, 200);
    assert.equal((await call('/admin/categories', { method: 'POST', token: 'tok-carol', body: { name: 'Shoes' } })).status, 201);
    assert.equal((await call('/admin/categories', { method: 'POST', token: 'tok-carol', body: { name: 'S' } })).status, 400);
    assert.equal((await call('/admin/categories', { method: 'POST', token: 'tok-alice', body: { name: 'Hacked' } })).status, 403);
  });
});
