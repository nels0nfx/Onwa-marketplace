import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadEnv } from './env.js';

const valid = { SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'x'.repeat(40) };

test('loadEnv applies defaults', () => {
  const env = loadEnv(valid);
  assert.equal(env.PORT, 4000);
  assert.equal(env.NODE_ENV, 'development');
  assert.deepEqual(env.CORS_ORIGINS, ['http://localhost:3000']);
  assert.equal(env.TRUST_PROXY_HOPS, 0);
});

test('loadEnv requires Supabase URL and service key', () => {
  assert.throws(() => loadEnv({}), /Invalid environment configuration/);
  assert.throws(() => loadEnv({ ...valid, SUPABASE_SERVICE_ROLE_KEY: 'short' }), /too short/);
  assert.throws(() => loadEnv({ ...valid, SUPABASE_URL: 'not-a-url' }), /SUPABASE_URL/);
});

test('loadEnv never echoes secret values in errors', () => {
  const secret = 'super-secret-value-that-must-not-leak';
  try {
    loadEnv({ SUPABASE_URL: 'bad', SUPABASE_SERVICE_ROLE_KEY: secret });
    assert.fail('should throw');
  } catch (e) {
    assert.ok(!(e as Error).message.includes(secret));
  }
});

test('CORS: wildcard rejected; production requires https; lists are split and trimmed', () => {
  assert.throws(() => loadEnv({ ...valid, CORS_ORIGINS: '*' }), /Wildcard/);
  assert.throws(() => loadEnv({ ...valid, NODE_ENV: 'production', CORS_ORIGINS: 'http://onwa.ng' }), /https/);
  const env = loadEnv({ ...valid, NODE_ENV: 'production', CORS_ORIGINS: 'https://onwa.ng, https://www.onwa.ng' });
  assert.deepEqual(env.CORS_ORIGINS, ['https://onwa.ng', 'https://www.onwa.ng']);
});

test('numeric settings are coerced and bounded', () => {
  assert.equal(loadEnv({ ...valid, PORT: '8080' }).PORT, 8080);
  assert.throws(() => loadEnv({ ...valid, PORT: '70000' }));
  assert.throws(() => loadEnv({ ...valid, RATE_LIMIT_GLOBAL_PER_15_MIN: '0' }));
});
