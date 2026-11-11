import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createApp } from './app.js';
import { IDS, makeDeps, testConfig } from './test-helpers.js';

function start(config = testConfig) {
  const deps = makeDeps();
  const server: Server = createApp(deps, config).listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  const call = (path: string, init: { method?: string; token?: string; body?: unknown; headers?: Record<string, string> } = {}) =>
    fetch(`${base}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
      body: init.body !== undefined ? (typeof init.body === 'string' ? init.body : JSON.stringify(init.body)) : undefined,
    });
  return { deps, server, call, close: () => new Promise<void>((r) => server.close(() => r())) };
}

describe('API v1', () => {
  const ctx = start();
  after(() => ctx.close());

  test('health is public and sets security headers + request id', async () => {
    const res = await ctx.call('/health');
    assert.equal(res.status, 200);
    assert.equal((await res.json() as { status: string }).status, 'ok');
    assert.ok(res.headers.get('x-request-id'));
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-powered-by'), null);
  });

  describe('authentication', () => {
    test('missing, malformed and unknown tokens are 401', async () => {
      assert.equal((await ctx.call('/me')).status, 401);
      assert.equal((await ctx.call('/me', { headers: { authorization: 'Basic abc' } })).status, 401);
      assert.equal((await ctx.call('/me', { token: 'not-a-real-token' })).status, 401);
    });
    test('suspended accounts are 403', async () => {
      assert.equal((await ctx.call('/me', { token: 'tok-suspended' })).status, 403);
    });
    test('GET /me returns profile, roles and permissions', async () => {
      const res = await ctx.call('/me', { token: 'tok-alice' });
      assert.equal(res.status, 200);
      const body = await res.json() as { profile: { id: string }; roles: string[]; permissions: string[] };
      assert.equal(body.profile.id, IDS.alice);
      assert.deepEqual(body.roles, ['customer']);
      assert.deepEqual(body.permissions, []);
    });
  });

  describe('profile update', () => {
    test('accepts valid fields and normalises phone', async () => {
      const res = await ctx.call('/me', { method: 'PATCH', token: 'tok-alice', body: { fullName: 'Alice Obi', phone: '08031234567' } });
      assert.equal(res.status, 200);
      const body = await res.json() as { profile: { fullName: string; phone: string } };
      assert.equal(body.profile.fullName, 'Alice Obi');
      assert.equal(body.profile.phone, '+2348031234567');
    });
    test('rejects forbidden fields (status, email, roles) and invalid values', async () => {
      for (const body of [{ status: 'active' }, { fullName: 'Ada Obi', email: 'x@y.co' }, { roles: ['super_admin'] }, { phone: 'abc' }, {}]) {
        const res = await ctx.call('/me', { method: 'PATCH', token: 'tok-alice', body });
        assert.equal(res.status, 400, JSON.stringify(body));
      }
    });
    test('requires authentication', async () => {
      assert.equal((await ctx.call('/me', { method: 'PATCH', body: { fullName: 'Ada Obi' } })).status, 401);
    });
  });

  describe('admin authorization', () => {
    test('customers cannot reach admin endpoints', async () => {
      for (const path of ['/admin/users', '/admin/roles', '/admin/audit-logs']) {
        assert.equal((await ctx.call(path, { token: 'tok-alice' })).status, 403, path);
      }
    });
    test('permissions are enforced per endpoint, not per title', async () => {
      assert.equal((await ctx.call('/admin/users', { token: 'tok-erin' })).status, 200); // customers.read
      assert.equal((await ctx.call('/admin/users', { token: 'tok-dave' })).status, 403); // finance lacks customers.read
      assert.equal((await ctx.call('/admin/audit-logs', { token: 'tok-erin' })).status, 403);
      assert.equal((await ctx.call('/admin/audit-logs', { token: 'tok-carol' })).status, 200);
      assert.equal((await ctx.call('/admin/roles', { token: 'tok-carol' })).status, 200);
    });
    test('list query is validated and search is sanitised before reaching the repository', async () => {
      assert.equal((await ctx.call('/admin/users?limit=500', { token: 'tok-carol' })).status, 400);
      ctx.deps.users.calls.length = 0;
      const res = await ctx.call('/admin/users?q=' + encodeURIComponent('a,b)%'), { token: 'tok-carol' });
      assert.equal(res.status, 200);
      assert.deepEqual(ctx.deps.users.calls[0]?.args[0], { q: 'ab', limit: 20, offset: 0 });
    });
  });

  describe('role management', () => {
    test('support/finance/customer cannot assign roles', async () => {
      for (const token of ['tok-alice', 'tok-erin', 'tok-dave']) {
        const res = await ctx.call(`/admin/users/${IDS.bob}/roles`, { method: 'POST', token, body: { role: 'seller' } });
        assert.equal(res.status, 403, token);
      }
      assert.ok(!ctx.deps.users.calls.some((c) => c.fn === 'assignRole'));
    });
    test('super admin can assign and revoke; calls reach the repository with the actor id', async () => {
      const a = await ctx.call(`/admin/users/${IDS.bob}/roles`, { method: 'POST', token: 'tok-carol', body: { role: 'seller' } });
      assert.equal(a.status, 204);
      const r = await ctx.call(`/admin/users/${IDS.bob}/roles/seller`, { method: 'DELETE', token: 'tok-carol' });
      assert.equal(r.status, 204);
      assert.deepEqual(ctx.deps.users.calls.filter((c) => c.fn === 'assignRole').at(-1)?.args, [IDS.carol, IDS.bob, 'seller']);
      assert.deepEqual(ctx.deps.users.calls.filter((c) => c.fn === 'revokeRole').at(-1)?.args, [IDS.carol, IDS.bob, 'seller']);
    });
    test('self-assignment, base-role revocation, bad ids and bad roles are rejected', async () => {
      const before = ctx.deps.users.calls.length;
      assert.equal((await ctx.call(`/admin/users/${IDS.carol}/roles`, { method: 'POST', token: 'tok-carol', body: { role: 'finance_manager' } })).status, 403);
      assert.equal((await ctx.call(`/admin/users/${IDS.bob}/roles/customer`, { method: 'DELETE', token: 'tok-carol' })).status, 403);
      assert.equal((await ctx.call('/admin/users/not-a-uuid/roles', { method: 'POST', token: 'tok-carol', body: { role: 'seller' } })).status, 400);
      assert.equal((await ctx.call(`/admin/users/${IDS.bob}/roles`, { method: 'POST', token: 'tok-carol', body: { role: 'root' } })).status, 400);
      assert.equal((await ctx.call(`/admin/users/${IDS.bob}/roles`, { method: 'POST', token: 'tok-carol', body: { role: 'seller', extra: true } })).status, 400);
      assert.equal((await ctx.call(`/admin/users/${IDS.bob}/roles/root`, { method: 'DELETE', token: 'tok-carol' })).status, 400);
      assert.equal(ctx.deps.users.calls.length, before, 'no repository mutation may happen for rejected requests');
    });
  });

  describe('robustness', () => {
    test('malformed JSON is a 400 JSON error, not a stack trace', async () => {
      const res = await ctx.call('/me', { method: 'PATCH', token: 'tok-alice', body: '{bad json' });
      assert.equal(res.status, 400);
      const body = await res.json() as { error: { code: string } };
      assert.equal(body.error.code, 'bad_request');
    });
    test('oversized bodies are rejected', async () => {
      const res = await ctx.call('/me', { method: 'PATCH', token: 'tok-alice', body: { fullName: 'x'.repeat(200_000) } });
      assert.equal(res.status, 413);
    });
    test('unknown routes return a JSON 404 once authenticated', async () => {
      const res = await ctx.call('/nope', { token: 'tok-alice' });
      assert.equal(res.status, 404);
    });
    test('CORS: allowed origin is echoed, other origins are not', async () => {
      const ok = await ctx.call('/health', { headers: { origin: 'http://localhost:3000' } });
      assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:3000');
      const bad = await ctx.call('/health', { headers: { origin: 'https://evil.example' } });
      assert.equal(bad.headers.get('access-control-allow-origin'), null);
    });
  });
});

describe('rate limiting', () => {
  let limited: ReturnType<typeof start>;
  before(() => { limited = start({ ...testConfig, RATE_LIMIT_ADMIN_WRITES_PER_MIN: 2 }); });
  after(() => limited.close());

  test('admin writes are limited per user', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await limited.call(`/admin/users/${IDS.bob}/roles`, { method: 'POST', token: 'tok-carol', body: { role: 'seller' } });
      statuses.push(res.status);
    }
    assert.deepEqual(statuses, [204, 204, 429, 429]);
  });
});
