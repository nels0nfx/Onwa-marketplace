import type {
  AdminUserRow, AuditLogRow, Paged, PermissionCode, Profile, RoleCode, RoleSummary,
} from '@onwa/shared';
import type { Logger } from './lib/logger.js';

export interface VerifiedUser {
  id: string;
  email: string | null;
}

/** Verifies a Supabase access token. Returns null when the token is invalid or expired. */
export interface TokenVerifier {
  verify(accessToken: string): Promise<VerifiedUser | null>;
}

export interface UserAccess {
  roles: RoleCode[];
  permissions: PermissionCode[];
}

export interface UserRepository {
  getProfile(userId: string): Promise<Profile | null>;
  updateProfile(userId: string, patch: { fullName?: string; phone?: string | null }): Promise<Profile>;
  getAccess(userId: string): Promise<UserAccess>;
  listUsers(params: { q?: string; limit: number; offset: number }): Promise<Paged<AdminUserRow>>;
  listRoles(): Promise<RoleSummary[]>;
  assignRole(actorId: string, targetId: string, role: RoleCode): Promise<void>;
  revokeRole(actorId: string, targetId: string, role: RoleCode): Promise<void>;
  listAuditLogs(params: { limit: number; offset: number }): Promise<Paged<AuditLogRow>>;
}

export interface AppDeps {
  tokenVerifier: TokenVerifier;
  users: UserRepository;
  logger: Logger;
}
