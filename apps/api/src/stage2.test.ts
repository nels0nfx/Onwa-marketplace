import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from './app.js';
import { IDS, makeDeps, testConfig } from './test-helpers.js';

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

const address = { recipientName: 'Chika Obi', phone: '08031234567', line1: '5 Ada George Road', city: 'Port Harcourt', lga: 'Obio-Akpor', state: 'Rivers' };

const completeDraft = {
  legalName: 'Bola Ade', businessName: 'Bola Beads', contactEmail: 'bola@example.com', contactPhone: '08031234567',
  addressLine1: '3 Allen Avenue', addressCity: 'Ikeja', addressLga: 'Ikeja', addressState: 'Lagos', categories: ['Fashion and clothing'],
  description: 'Handmade beaded jewellery and accessories sold across Nigeria since 2019.', idType: 'nin',
  bankName: 'GTBank', bankAccountNumber: '0123456789', bankAccountName: 'Bola Ade',
};

describe('addresses', () => {
  test('require authentication', async () => {
    assert.equal((await call('/me/addresses')).status, 401);
  });
  test('create normalises phone; first address becomes default', async () => {
    const r = await call('/me/addresses', { method: 'POST', token: 'tok-alice', body: address });
    assert.equal(r.status, 201);
    assert.equal(r.json?.address.phone, '+2348031234567');
    assert.equal(r.json?.address.isDefault, true);
  });
  test('validation rejects bad state, extra keys and a smuggled user id', async () => {
    assert.equal((await call('/me/addresses', { method: 'POST', token: 'tok-alice', body: { ...address, state: 'Texas' } })).status, 400);
    assert.equal((await call('/me/addresses', { method: 'POST', token: 'tok-alice', body: { ...address, userId: IDS.bob } })).status, 400);
  });
  test('users cannot see, edit or delete each other\'s addresses', async () => {
    const mine = await call('/me/addresses', { token: 'tok-alice' });
    const id = mine.json?.addresses[0].id as string;
    assert.equal((await call('/me/addresses', { token: 'tok-bob' })).json?.addresses.length, 0);
    assert.equal((await call(`/me/addresses/${id}`, { method: 'PUT', token: 'tok-bob', body: address })).status, 404);
    assert.equal((await call(`/me/addresses/${id}`, { method: 'DELETE', token: 'tok-bob' })).status, 404);
    assert.equal((await call(`/me/addresses/${id}`, { method: 'DELETE', token: 'tok-alice' })).status, 204);
  });
});

describe('seller application (applicant)', () => {
  test('sellers cannot start a second application', async () => {
    assert.equal((await call('/seller/application', { method: 'PUT', token: 'tok-seller', body: completeDraft })).status, 403);
  });
  test('draft saves, status cannot be smuggled, incomplete submit is refused', async () => {
    assert.equal((await call('/seller/application', { method: 'PUT', token: 'tok-bob', body: { ...completeDraft, status: 'approved' } })).status, 400);
    const saved = await call('/seller/application', { method: 'PUT', token: 'tok-bob', body: { legalName: 'Bob Obi' } });
    assert.equal(saved.status, 200);
    assert.equal(saved.json?.application.status, 'draft');
    const submit = await call('/seller/application/submit', { method: 'POST', token: 'tok-bob' });
    assert.equal(submit.status, 400);
  });
  test('document paths must be inside the caller\'s own folder for their own application', async () => {
    const app = (await call('/seller/application', { method: 'PUT', token: 'tok-alice', body: completeDraft })).json?.application;
    const goodPath = `${IDS.alice}/${app.id}/11111111-1111-4111-8111-111111111111.pdf`;
    const body = { kind: 'identity', path: goodPath, originalName: 'id.pdf', mimeType: 'application/pdf', sizeBytes: 2000 };
    // object does not exist in storage yet
    assert.equal((await call('/seller/application/documents', { method: 'POST', token: 'tok-alice', body })).status, 400);
    // someone else's folder
    const stolen = { ...body, path: `${IDS.bob}/${app.id}/11111111-1111-4111-8111-111111111111.pdf` };
    deps.sellers.objects.add(stolen.path);
    assert.equal((await call('/seller/application/documents', { method: 'POST', token: 'tok-alice', body: stolen })).status, 400);
    // path traversal
    assert.equal((await call('/seller/application/documents', { method: 'POST', token: 'tok-alice', body: { ...body, path: `${IDS.alice}/${app.id}/../x.pdf` } })).status, 400);
    // valid
    deps.sellers.objects.add(goodPath);
    assert.equal((await call('/seller/application/documents', { method: 'POST', token: 'tok-alice', body })).status, 201);
  });
  test('complete application with an identity document submits; then it is locked for editing', async () => {
    const submit = await call('/seller/application/submit', { method: 'POST', token: 'tok-alice' });
    assert.equal(submit.status, 200);
    assert.equal(submit.json?.application.status, 'submitted');
    assert.equal((await call('/seller/application', { method: 'PUT', token: 'tok-alice', body: completeDraft })).status, 409);
    const app = submit.json?.application;
    const path = `${IDS.alice}/${app.id}/22222222-2222-4222-8222-222222222222.png`;
    deps.sellers.objects.add(path);
    const late = await call('/seller/application/documents', { method: 'POST', token: 'tok-alice', body: { kind: 'other', path, originalName: 'x.png', mimeType: 'image/png', sizeBytes: 10 } });
    assert.equal(late.status, 403);
  });
});

describe('seller application (review)', () => {
  let appId = '';
  test('only staff with the right permissions can list or review', async () => {
    appId = deps.sellers.apps.get(IDS.alice)?.id ?? '';
    for (const token of ['tok-alice', 'tok-bob', 'tok-erin', 'tok-dave', 'tok-seller']) {
      assert.equal((await call('/admin/seller-applications', { token })).status, 403, token);
      assert.equal((await call(`/admin/seller-applications/${appId}/decision`, { method: 'POST', token, body: { decision: 'start_review' } })).status, 403, token);
    }
    assert.equal((await call('/admin/seller-applications', { token: 'tok-manager' })).status, 200);
    assert.equal((await call('/admin/seller-applications', { token: 'tok-carol' })).status, 200);
  });
  test('decisions follow the workflow and require notes where mandated', async () => {
    const d = (decision: string, note?: string) => call(`/admin/seller-applications/${appId}/decision`, { method: 'POST', token: 'tok-manager', body: { decision, ...(note ? { note } : {}) } });
    assert.equal((await d('approve')).status, 409, 'cannot approve before review starts');
    assert.equal((await d('start_review')).status, 204);
    assert.equal((await d('request_info')).status, 400, 'note required');
    assert.equal((await d('request_info', 'Please upload a clearer ID')).status, 204);
    assert.equal(deps.sellers.apps.get(IDS.alice)?.status, 'more_info_required');
    assert.equal((await d('bogus')).status, 400);
  });
  test('detail endpoint 404s for unknown applications and rejects non-uuid ids', async () => {
    assert.equal((await call('/admin/seller-applications/not-a-uuid', { token: 'tok-manager' })).status, 400);
    assert.equal((await call('/admin/seller-applications/99999999-9999-4999-8999-999999999999', { token: 'tok-manager' })).status, 404);
  });
  test('suspending a seller needs sellers.manage and a note; suspended store disappears from public view', async () => {
    const sid = '20000000-0000-4000-8000-000000000001';
    assert.equal((await call(`/admin/sellers/${sid}/status`, { method: 'POST', token: 'tok-erin', body: { status: 'suspended', note: 'Policy violation' } })).status, 403);
    assert.equal((await call(`/admin/sellers/${sid}/status`, { method: 'POST', token: 'tok-manager', body: { status: 'suspended' } })).status, 400);
    assert.equal((await call(`/admin/sellers/${sid}/status`, { method: 'POST', token: 'tok-manager', body: { status: 'suspended', note: 'Policy violation' } })).status, 204);
    assert.equal((await call('/stores/amaka-crafts')).status, 404);
    assert.equal((await call(`/admin/sellers/${sid}/status`, { method: 'POST', token: 'tok-manager', body: { status: 'active' } })).status, 204);
    assert.equal((await call('/stores/amaka-crafts')).status, 200);
  });
});

describe('public storefronts and follows', () => {
  test('public store returns only public fields', async () => {
    const r = await call('/stores/amaka-crafts');
    assert.equal(r.status, 200);
    const keys = Object.keys(r.json?.store ?? {}).sort();
    assert.deepEqual(keys, ['accent', 'coverUrl', 'deliveryInfo', 'description', 'followers', 'logoUrl', 'name', 'policies', 'since', 'slug', 'tagline', 'verified']);
  });
  test('unknown, suspended and malformed slugs are not served', async () => {
    assert.equal((await call('/stores/does-not-exist')).status, 404);
    assert.equal((await call('/stores/closed-shop')).status, 404);
    assert.equal((await call('/stores/Bad_Slug!')).status, 400);
  });
  test('directory lists only active stores', async () => {
    const r = await call('/stores');
    assert.equal(r.status, 200);
    assert.deepEqual((r.json?.rows as { slug: string }[]).map((s) => s.slug), ['amaka-crafts']);
  });
  test('following needs sign-in; follow/unfollow round-trips', async () => {
    assert.equal((await call('/stores/amaka-crafts/follow', { method: 'POST' })).status, 401);
    assert.equal((await call('/stores/amaka-crafts/follow', { method: 'POST', token: 'tok-bob' })).status, 204);
    assert.deepEqual((await call('/me/follows', { token: 'tok-bob' })).json?.slugs, ['amaka-crafts']);
    assert.equal((await call('/stores/amaka-crafts')).json?.store.followers, 1);
    assert.equal((await call('/stores/amaka-crafts/follow', { method: 'DELETE', token: 'tok-bob' })).status, 204);
    assert.equal((await call('/stores/closed-shop/follow', { method: 'POST', token: 'tok-bob' })).status, 404);
  });
});

describe('seller store management', () => {
  test('non-sellers have no store', async () => {
    assert.equal((await call('/seller/store', { token: 'tok-alice' })).status, 404);
    assert.equal((await call('/seller/store', { method: 'PUT', token: 'tok-alice', body: { name: 'Mine', accent: 'gold' } })).status, 403);
  });
  test('seller edits own store; arbitrary CSS/accents and extra fields are rejected', async () => {
    assert.equal((await call('/seller/store', { method: 'PUT', token: 'tok-seller', body: { name: 'Amaka Crafts Plus', accent: 'forest', tagline: 'Baskets' } })).status, 200);
    assert.equal((await call('/seller/store', { method: 'PUT', token: 'tok-seller', body: { name: 'X Store', accent: 'red; background:url(x)' } })).status, 400);
    assert.equal((await call('/seller/store', { method: 'PUT', token: 'tok-seller', body: { name: 'X Store', accent: 'gold', slug: 'hijack' } })).status, 400);
  });
  test('media paths must belong to the seller\'s own folder', async () => {
    const sid = '20000000-0000-4000-8000-000000000001';
    const ok = `${sid}/logo-33333333-3333-4333-8333-333333333333.png`;
    const foreign = `20000000-0000-4000-8000-000000000002/logo-33333333-3333-4333-8333-333333333333.png`;
    deps.sellers.objects.add(ok); deps.sellers.objects.add(foreign);
    assert.equal((await call('/seller/store/media', { method: 'POST', token: 'tok-seller', body: { kind: 'logo', path: foreign } })).status, 400);
    assert.equal((await call('/seller/store/media', { method: 'POST', token: 'tok-seller', body: { kind: 'cover', path: ok } })).status, 400, 'kind must match filename');
    assert.equal((await call('/seller/store/media', { method: 'POST', token: 'tok-seller', body: { kind: 'logo', path: ok } })).status, 200);
  });
});
