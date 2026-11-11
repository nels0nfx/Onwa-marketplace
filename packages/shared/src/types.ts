import type { PermissionCode } from './permissions.js';
import type { RoleCode } from './roles.js';

export type AccountStatus = 'active' | 'suspended' | 'deactivated';

export interface Profile {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  avatarUrl: string | null;
  status: AccountStatus;
  createdAt: string;
}

export interface MeResponse {
  profile: Profile;
  roles: RoleCode[];
  permissions: PermissionCode[];
}

export interface AdminUserRow extends Profile {
  roles: RoleCode[];
}

export interface Paged<T> {
  rows: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface RoleSummary {
  code: RoleCode;
  name: string;
  description: string;
  isStaff: boolean;
  permissions: PermissionCode[];
}

export interface AuditLogRow {
  id: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ApiErrorBody {
  error: { code: string; message: string; requestId?: string; details?: { field: string; message: string }[] };
}
