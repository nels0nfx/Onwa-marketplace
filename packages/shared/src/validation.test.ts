import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePhone, sanitizeSearchTerm, safeRedirectPath, registerSchema, loginSchema, profileUpdateSchema,
  roleChangeSchema, listUsersQuerySchema, passwordSchema, resetPasswordSchema,
} from './validation.js';

test('normalizePhone handles Nigerian formats and rejects junk', () => {
  assert.equal(normalizePhone('08031234567'), '+2348031234567');
  assert.equal(normalizePhone('0803 123 4567'), '+2348031234567');
  assert.equal(normalizePhone('2348031234567'), '+2348031234567');
  assert.equal(normalizePhone('+2348031234567'), '+2348031234567');
  assert.equal(normalizePhone('+14155552671'), '+14155552671');
  assert.equal(normalizePhone('12345'), null);
  assert.equal(normalizePhone('0603123456'), null);
  assert.equal(normalizePhone('abc'), null);
});

test('sanitizeSearchTerm strips PostgREST filter metacharacters', () => {
  assert.equal(sanitizeSearchTerm('amaka,email.eq.x)'), 'amakaemail.eq.x');
  assert.ok(!/[,()%*]/.test(sanitizeSearchTerm('a,b(c)%d*e')));
  assert.equal(sanitizeSearchTerm('a%b*c(d)'), 'abcd');
  assert.equal(sanitizeSearchTerm('  ada@example.com  '), 'ada@example.com');
  assert.equal(sanitizeSearchTerm('x'.repeat(200)).length, 64);
});

test('safeRedirectPath blocks open redirects', () => {
  assert.equal(safeRedirectPath('/admin'), '/admin');
  assert.equal(safeRedirectPath('/account?x=1'), '/account?x=1');
  assert.equal(safeRedirectPath('//evil.com'), '/account');
  assert.equal(safeRedirectPath('https://evil.com'), '/account');
  assert.equal(safeRedirectPath('/\\evil.com'), '/account');
  assert.equal(safeRedirectPath('javascript:alert(1)'), '/account');
  assert.equal(safeRedirectPath('/ok\nbad'), '/account');
  assert.equal(safeRedirectPath(null), '/account');
  assert.equal(safeRedirectPath(undefined, '/x'), '/x');
});

test('passwordSchema enforces length and character classes', () => {
  assert.equal(passwordSchema.safeParse('Short1').success, false);
  assert.equal(passwordSchema.safeParse('alllowercase123').success, false);
  assert.equal(passwordSchema.safeParse('ALLUPPERCASE123').success, false);
  assert.equal(passwordSchema.safeParse('NoDigitsHereAtAll').success, false);
  assert.equal(passwordSchema.safeParse('GoodPassw0rdLagos').success, true);
  assert.equal(passwordSchema.safeParse('Aa1' + 'x'.repeat(80)).success, false);
});

test('registerSchema validates and normalises', () => {
  const ok = registerSchema.safeParse({
    fullName: '  Amaka Okafor ', email: ' Amaka@Example.COM ', password: 'GoodPassw0rdLagos',
    confirmPassword: 'GoodPassw0rdLagos', acceptTerms: 'on',
  });
  assert.equal(ok.success, true);
  if (ok.success) {
    assert.equal(ok.data.email, 'amaka@example.com');
    assert.equal(ok.data.fullName, 'Amaka Okafor');
  }
  const mismatch = registerSchema.safeParse({
    fullName: 'Amaka Okafor', email: 'a@b.co', password: 'GoodPassw0rdLagos', confirmPassword: 'Different1Passw0rd', acceptTerms: 'on',
  });
  assert.equal(mismatch.success, false);
  const noTerms = registerSchema.safeParse({
    fullName: 'Amaka Okafor', email: 'a@b.co', password: 'GoodPassw0rdLagos', confirmPassword: 'GoodPassw0rdLagos',
  });
  assert.equal(noTerms.success, false);
  const badName = registerSchema.safeParse({
    fullName: '<script>', email: 'a@b.co', password: 'GoodPassw0rdLagos', confirmPassword: 'GoodPassw0rdLagos', acceptTerms: 'on',
  });
  assert.equal(badName.success, false);
});

test('resetPasswordSchema requires matching strong passwords', () => {
  assert.equal(resetPasswordSchema.safeParse({ password: 'GoodPassw0rdLagos', confirmPassword: 'GoodPassw0rdLagos' }).success, true);
  assert.equal(resetPasswordSchema.safeParse({ password: 'GoodPassw0rdLagos', confirmPassword: 'nope' }).success, false);
});

test('loginSchema', () => {
  assert.equal(loginSchema.safeParse({ email: 'a@b.co', password: 'x' }).success, true);
  assert.equal(loginSchema.safeParse({ email: 'nope', password: 'x' }).success, false);
  assert.equal(loginSchema.safeParse({ email: 'a@b.co', password: '' }).success, false);
});

test('profileUpdateSchema: partial updates, phone normalisation, clearing, strictness', () => {
  const a = profileUpdateSchema.parse({ phone: '08031234567' });
  assert.equal(a.phone, '+2348031234567');
  assert.equal(profileUpdateSchema.parse({ phone: '' }).phone, null);
  assert.equal(profileUpdateSchema.safeParse({}).success, false);
  assert.equal(profileUpdateSchema.safeParse({ phone: 'bad' }).success, false);
  // clients must not be able to smuggle status/email/role fields
  assert.equal(profileUpdateSchema.safeParse({ fullName: 'Ada Obi', status: 'active' }).success, false);
  assert.equal(profileUpdateSchema.safeParse({ fullName: 'Ada Obi', email: 'x@y.co' }).success, false);
});

test('roleChangeSchema only accepts known roles and rejects extra keys', () => {
  assert.equal(roleChangeSchema.safeParse({ role: 'seller' }).success, true);
  assert.equal(roleChangeSchema.safeParse({ role: 'root' }).success, false);
  assert.equal(roleChangeSchema.safeParse({ role: 'seller', extra: 1 }).success, false);
});

test('listUsersQuerySchema applies defaults, bounds and sanitises q', () => {
  const d = listUsersQuerySchema.parse({});
  assert.equal(d.q, undefined);
  assert.equal(d.limit, 20);
  assert.equal(d.offset, 0);
  assert.equal(listUsersQuerySchema.parse({ q: 'a,b)' }).q, 'ab');
  assert.equal(listUsersQuerySchema.safeParse({ limit: '500' }).success, false);
  assert.equal(listUsersQuerySchema.safeParse({ offset: '-1' }).success, false);
});
