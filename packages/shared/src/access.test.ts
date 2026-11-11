import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canAssignRole, canRevokeRole, hasPermission, hasAnyPermission, type RoleChangeContext } from './access.js';

const base: RoleChangeContext = {
  actorId: 'a',
  targetId: 'b',
  actorRoles: ['super_admin'],
  actorPermissions: ['roles.assign', 'admin.access'],
  role: 'seller',
};

test('hasPermission / hasAnyPermission', () => {
  assert.equal(hasPermission(['audit.read'], 'audit.read'), true);
  assert.equal(hasPermission([], 'audit.read'), false);
  assert.equal(hasAnyPermission(['orders.read'], ['audit.read', 'orders.read']), true);
  assert.equal(hasAnyPermission([], ['audit.read']), false);
});

test('assign: allowed for super admin with roles.assign', () => {
  assert.deepEqual(canAssignRole(base), { allowed: true });
});

test('assign: denied without roles.assign', () => {
  const d = canAssignRole({ ...base, actorPermissions: ['admin.access'] });
  assert.equal(d.allowed, false);
});

test('assign: denied on self (privilege escalation guard)', () => {
  const d = canAssignRole({ ...base, targetId: 'a', role: 'super_admin' });
  assert.equal(d.allowed, false);
});

test('assign super_admin: denied unless actor is super_admin', () => {
  const d = canAssignRole({ ...base, actorRoles: ['finance_manager'], role: 'super_admin' });
  assert.equal(d.allowed, false);
  assert.equal(canAssignRole({ ...base, role: 'super_admin' }).allowed, true);
});

test('revoke: customer base role can never be revoked', () => {
  assert.equal(canRevokeRole({ ...base, role: 'customer' }).allowed, false);
});

test('revoke: same guards as assign', () => {
  assert.equal(canRevokeRole({ ...base, actorPermissions: [] }).allowed, false);
  assert.equal(canRevokeRole({ ...base, targetId: 'a' }).allowed, false);
  assert.equal(canRevokeRole({ ...base, actorRoles: [], role: 'super_admin' }).allowed, false);
  assert.equal(canRevokeRole(base).allowed, true);
});
