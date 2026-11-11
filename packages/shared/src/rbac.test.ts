import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PERMISSIONS, PERMISSION_CODES } from './permissions.js';
import { ROLE_CODES, ROLE_DEFINITIONS, ROLE_PERMISSIONS } from './roles.js';

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(resolve(here, '../../../supabase/migrations/0003_rbac.sql'), 'utf8');

function block(name: string): string {
  const m = new RegExp(`-- BEGIN ${name}\\n([\\s\\S]*?)-- END ${name}`).exec(sql);
  assert.ok(m, `missing seed block: ${name}`);
  return m[1] as string;
}

test('SQL roles seed matches ROLE_DEFINITIONS', () => {
  const rows = [...block('roles seed').matchAll(/\('([a-z_]+)', '([^']*)', (true|false), '([^']*)'\)/g)];
  const sqlRoles = Object.fromEntries(rows.map((r) => [r[1], { name: r[2], isStaff: r[3] === 'true', description: r[4] }]));
  assert.deepEqual(Object.keys(sqlRoles).sort(), [...ROLE_CODES].sort());
  for (const code of ROLE_CODES) assert.deepEqual(sqlRoles[code], ROLE_DEFINITIONS[code], `role ${code}`);
});

test('SQL permissions seed matches PERMISSIONS', () => {
  const rows = [...block('permissions seed').matchAll(/\('([a-z_.]+)', '([^']*)'\)/g)];
  const sqlPerms = Object.fromEntries(rows.map((r) => [r[1], r[2]]));
  assert.deepEqual(Object.keys(sqlPerms).sort(), [...PERMISSION_CODES].sort());
  for (const code of PERMISSION_CODES) assert.equal(sqlPerms[code], PERMISSIONS[code], `permission ${code}`);
});

test('SQL role_permissions seed matches ROLE_PERMISSIONS (excluding super_admin cross join)', () => {
  const rows = [...block('role_permissions seed').matchAll(/\('([a-z_]+)', '([a-z_.]+)'\)/g)];
  const sqlMap: Record<string, string[]> = {};
  for (const r of rows) (sqlMap[r[1] as string] ??= []).push(r[2] as string);
  for (const role of ROLE_CODES) {
    if (role === 'super_admin') continue;
    assert.deepEqual([...(sqlMap[role] ?? [])].sort(), [...ROLE_PERMISSIONS[role]].sort(), `role ${role}`);
  }
  assert.equal(sqlMap['super_admin'], undefined);
});

test('super_admin has every permission and only super_admin has roles.assign', () => {
  assert.deepEqual([...ROLE_PERMISSIONS.super_admin].sort(), [...PERMISSION_CODES].sort());
  for (const role of ROLE_CODES) {
    assert.equal(ROLE_PERMISSIONS[role].includes('roles.assign'), role === 'super_admin', role);
  }
});

test('non-staff roles hold no admin permissions; staff roles all open the admin area', () => {
  for (const role of ROLE_CODES) {
    const perms = ROLE_PERMISSIONS[role];
    if (ROLE_DEFINITIONS[role].isStaff) assert.ok(perms.includes('admin.access'), role);
    else assert.equal(perms.length, 0, role);
  }
});

test('finance staff cannot manage roles, settings or audit logs', () => {
  const perms = ROLE_PERMISSIONS.finance_manager;
  for (const p of ['roles.assign', 'settings.manage', 'audit.read'] as const) assert.ok(!perms.includes(p));
});
