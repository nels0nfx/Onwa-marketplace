import type { AdminUserRow, AuditLogRow, Paged, PermissionCode, Profile, RoleCode, RoleSummary } from '@onwa/shared';
import { ROLE_DEFINITIONS, ROLE_PERMISSIONS } from '@onwa/shared';
import type { AppDeps, TokenVerifier, UserAccess, UserRepository } from './deps.js';
import { createLogger } from './lib/logger.js';

export const IDS = {
  alice: '00000000-0000-4000-8000-00000000000a',
  bob: '00000000-0000-4000-8000-00000000000b',
  carol: '00000000-0000-4000-8000-00000000000c',
  dave: '00000000-0000-4000-8000-00000000000d',
  erin: '00000000-0000-4000-8000-00000000000e',
  suspended: '00000000-0000-4000-8000-00000000000f',
} as const;

function profile(id: string, name: string, status: Profile['status'] = 'active'): Profile {
  return { id, email: `${name.toLowerCase()}@example.test`, fullName: name, phone: null, avatarUrl: null, status, createdAt: '2026-01-01T00:00:00.000Z' };
}

export class FakeUsers implements UserRepository {
  profiles = new Map<string, Profile>([
    [IDS.alice, profile(IDS.alice, 'Alice')],
    [IDS.bob, profile(IDS.bob, 'Bob')],
    [IDS.carol, profile(IDS.carol, 'Carol')],
    [IDS.dave, profile(IDS.dave, 'Dave')],
    [IDS.erin, profile(IDS.erin, 'Erin')],
    [IDS.suspended, profile(IDS.suspended, 'Sam', 'suspended')],
  ]);
  roles = new Map<string, RoleCode[]>([
    [IDS.alice, ['customer']],
    [IDS.bob, ['customer']],
    [IDS.carol, ['customer', 'super_admin']],
    [IDS.dave, ['customer', 'finance_manager']],
    [IDS.erin, ['customer', 'customer_support']],
    [IDS.suspended, ['customer']],
  ]);
  calls: { fn: string; args: unknown[] }[] = [];

  async getProfile(id: string) { return this.profiles.get(id) ?? null; }

  async updateProfile(id: string, patch: { fullName?: string; phone?: string | null }) {
    this.calls.push({ fn: 'updateProfile', args: [id, patch] });
    const current = this.profiles.get(id);
    if (!current) throw new Error('missing');
    const next = { ...current, ...(patch.fullName !== undefined ? { fullName: patch.fullName } : {}), ...(patch.phone !== undefined ? { phone: patch.phone } : {}) };
    this.profiles.set(id, next);
    return next;
  }

  async getAccess(id: string): Promise<UserAccess> {
    const roles = this.roles.get(id) ?? [];
    const permissions = [...new Set(roles.flatMap((r) => ROLE_PERMISSIONS[r]))] as PermissionCode[];
    return { roles, permissions };
  }

  async listUsers(p: { q?: string; limit: number; offset: number }): Promise<Paged<AdminUserRow>> {
    this.calls.push({ fn: 'listUsers', args: [p] });
    const rows = [...this.profiles.values()].map((pr) => ({ ...pr, roles: this.roles.get(pr.id) ?? [] }));
    return { rows, total: rows.length, limit: p.limit, offset: p.offset };
  }

  async listRoles(): Promise<RoleSummary[]> {
    return (Object.keys(ROLE_DEFINITIONS) as RoleCode[]).map((code) => ({
      code, name: ROLE_DEFINITIONS[code].name, description: ROLE_DEFINITIONS[code].description, isStaff: ROLE_DEFINITIONS[code].isStaff, permissions: [...ROLE_PERMISSIONS[code]],
    }));
  }

  async assignRole(actor: string, target: string, role: RoleCode) { this.calls.push({ fn: 'assignRole', args: [actor, target, role] }); }
  async revokeRole(actor: string, target: string, role: RoleCode) { this.calls.push({ fn: 'revokeRole', args: [actor, target, role] }); }
  async listAuditLogs(p: { limit: number; offset: number }): Promise<Paged<AuditLogRow>> { return { rows: [], total: 0, limit: p.limit, offset: p.offset }; }
}

export class FakeVerifier implements TokenVerifier {
  tokens = new Map<string, string>([
    ['tok-alice', IDS.alice], ['tok-bob', IDS.bob], ['tok-carol', IDS.carol], ['tok-dave', IDS.dave], ['tok-erin', IDS.erin], ['tok-suspended', IDS.suspended],
  ]);
  async verify(token: string) {
    const id = this.tokens.get(token);
    return id ? { id, email: `${id}@example.test` } : null;
  }
}

export function makeDeps(): AppDeps & { users: FakeUsers } {
  return { tokenVerifier: new FakeVerifier(), users: new FakeUsers(), logger: createLogger('error', () => undefined) };
}

export const testConfig = {
  CORS_ORIGINS: ['http://localhost:3000'],
  TRUST_PROXY_HOPS: 0,
  RATE_LIMIT_GLOBAL_PER_15_MIN: 1000,
  RATE_LIMIT_ADMIN_WRITES_PER_MIN: 1000,
};
