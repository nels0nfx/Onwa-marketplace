import type { SupabaseClient } from '@supabase/supabase-js';
import {
  isPermissionCode, isRoleCode, ROLE_DEFINITIONS,
  type AdminUserRow, type AuditLogRow, type Paged, type PermissionCode, type Profile, type RoleCode, type RoleSummary,
} from '@onwa/shared';
import type { TokenVerifier, UserAccess, UserRepository, VerifiedUser } from '../../deps.js';
import { AppError, conflict, forbidden, notFound } from '../../lib/errors.js';

const PROFILE_COLUMNS = 'id,email,full_name,phone,avatar_url,status,created_at';

interface ProfileRow {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  avatar_url: string | null;
  status: Profile['status'];
  created_at: string;
}

const toProfile = (r: ProfileRow): Profile => ({
  id: r.id, email: r.email, fullName: r.full_name, phone: r.phone, avatarUrl: r.avatar_url, status: r.status, createdAt: r.created_at,
});

/** Maps PostgreSQL error codes raised by our SQL functions to API errors. */
function mapDbError(error: { code?: string; message: string }): AppError {
  switch (error.code) {
    case '42501': return forbidden(error.message);
    case 'P0002': return notFound(error.message);
    case '23514': return conflict(error.message);
    case '22023': return new AppError(400, 'bad_request', error.message);
    default: { console.error(JSON.stringify({ level: 'error', msg: 'db_error', code: error.code, message: error.message })); return new AppError(500, 'internal_error', 'Database error'); }
  }
}

export class SupabaseTokenVerifier implements TokenVerifier {
  constructor(private readonly client: SupabaseClient) {}

  async verify(accessToken: string): Promise<VerifiedUser | null> {
    const { data, error } = await this.client.auth.getUser(accessToken);
    if (error || !data.user) return null;
    return { id: data.user.id, email: data.user.email ?? null };
  }
}

export class SupabaseUserRepository implements UserRepository {
  constructor(private readonly db: SupabaseClient) {}

  async getProfile(userId: string): Promise<Profile | null> {
    const { data, error } = await this.db.from('profiles').select(PROFILE_COLUMNS).eq('id', userId).maybeSingle();
    if (error) throw mapDbError(error);
    return data ? toProfile(data as ProfileRow) : null;
  }

  async updateProfile(userId: string, patch: { fullName?: string; phone?: string | null }): Promise<Profile> {
    const update: Record<string, unknown> = {};
    if (patch.fullName !== undefined) update.full_name = patch.fullName;
    if (patch.phone !== undefined) update.phone = patch.phone;
    const { data, error } = await this.db.from('profiles').update(update).eq('id', userId).select(PROFILE_COLUMNS).single();
    if (error) throw mapDbError(error);
    return toProfile(data as ProfileRow);
  }

  async getAccess(userId: string): Promise<UserAccess> {
    const { data, error } = await this.db.rpc('get_user_access', { p_user: userId });
    if (error) throw mapDbError(error);
    const raw = (data ?? {}) as { roles?: unknown[]; permissions?: unknown[] };
    const roles = (raw.roles ?? []).filter(isRoleCode) as RoleCode[];
    const permissions = (raw.permissions ?? []).filter(isPermissionCode) as PermissionCode[];
    return { roles, permissions };
  }

  async listUsers(params: { q?: string; limit: number; offset: number }): Promise<Paged<AdminUserRow>> {
    // user_roles has two foreign keys to profiles (user_id, granted_by), so the embed names the one to follow.
    let query = this.db
      .from('profiles')
      .select(`${PROFILE_COLUMNS}, user_roles!user_roles_user_id_fkey(roles(code))`, { count: 'exact' });
    if (params.q) {
      // q is sanitised by listUsersQuerySchema (no commas, parentheses, % or *).
      query = query.or(`email.ilike.%${params.q}%,full_name.ilike.%${params.q}%`);
    }
    const { data, error, count } = await query.order('created_at', { ascending: false }).range(params.offset, params.offset + params.limit - 1);
    if (error) throw mapDbError(error);
    const rows = ((data ?? []) as unknown as (ProfileRow & { user_roles: { roles: { code: string } | null }[] })[]).map((r) => ({
      ...toProfile(r),
      roles: r.user_roles.map((ur) => ur.roles?.code).filter(isRoleCode) as RoleCode[],
    }));
    return { rows, total: count ?? rows.length, limit: params.limit, offset: params.offset };
  }

  async listRoles(): Promise<RoleSummary[]> {
    const { data, error } = await this.db.from('roles').select('code,name,description,is_staff,role_permissions(permissions(code))').order('id');
    if (error) throw mapDbError(error);
    type Row = { code: string; name: string; description: string; is_staff: boolean; role_permissions: { permissions: { code: string } | null }[] };
    return ((data ?? []) as unknown as Row[])
      .filter((r) => isRoleCode(r.code))
      .map((r) => ({
        code: r.code as RoleCode,
        name: ROLE_DEFINITIONS[r.code as RoleCode].name,
        description: r.description,
        isStaff: r.is_staff,
        permissions: r.role_permissions.map((rp) => rp.permissions?.code).filter(isPermissionCode) as PermissionCode[],
      }));
  }

  async assignRole(actorId: string, targetId: string, role: RoleCode): Promise<void> {
    const { error } = await this.db.rpc('admin_assign_role', { p_actor: actorId, p_target: targetId, p_role: role });
    if (error) throw mapDbError(error);
  }

  async revokeRole(actorId: string, targetId: string, role: RoleCode): Promise<void> {
    const { error } = await this.db.rpc('admin_revoke_role', { p_actor: actorId, p_target: targetId, p_role: role });
    if (error) throw mapDbError(error);
  }

  async listAuditLogs(params: { limit: number; offset: number }): Promise<Paged<AuditLogRow>> {
    const { data, error, count } = await this.db
      .from('audit_logs')
      .select('id,actor_id,action,entity_type,entity_id,metadata,created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(params.offset, params.offset + params.limit - 1);
    if (error) throw mapDbError(error);
    type Row = { id: string; actor_id: string | null; action: string; entity_type: string; entity_id: string | null; metadata: Record<string, unknown>; created_at: string };
    const rows = ((data ?? []) as Row[]).map((r) => ({
      id: r.id, actorId: r.actor_id, action: r.action, entityType: r.entity_type, entityId: r.entity_id, metadata: r.metadata, createdAt: r.created_at,
    }));
    return { rows, total: count ?? rows.length, limit: params.limit, offset: params.offset };
  }
}
