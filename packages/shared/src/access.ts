import type { PermissionCode } from './permissions.js';
import type { RoleCode } from './roles.js';

export type Decision = { allowed: true } | { allowed: false; reason: string };

export function hasPermission(held: readonly string[], required: PermissionCode): boolean {
  return held.includes(required);
}

export function hasAnyPermission(held: readonly string[], required: readonly PermissionCode[]): boolean {
  return required.some((p) => held.includes(p));
}

export interface RoleChangeContext {
  actorId: string;
  targetId: string;
  actorRoles: readonly RoleCode[];
  actorPermissions: readonly string[];
  role: RoleCode;
}

/**
 * Application-layer mirror of the checks inside the SQL functions
 * public.admin_assign_role / public.admin_revoke_role. The database remains
 * the final authority; this gives a fast, testable first line of defence.
 */
function baseRoleChangeChecks(ctx: RoleChangeContext): Decision {
  if (!ctx.actorPermissions.includes('roles.assign')) {
    return { allowed: false, reason: 'Missing permission roles.assign' };
  }
  if (ctx.actorId === ctx.targetId) {
    return { allowed: false, reason: 'You cannot change your own roles' };
  }
  if (ctx.role === 'super_admin' && !ctx.actorRoles.includes('super_admin')) {
    return { allowed: false, reason: 'Only a super admin can change super admin access' };
  }
  return { allowed: true };
}

export function canAssignRole(ctx: RoleChangeContext): Decision {
  return baseRoleChangeChecks(ctx);
}

export function canRevokeRole(ctx: RoleChangeContext): Decision {
  if (ctx.role === 'customer') {
    return { allowed: false, reason: 'The customer role is the base role and cannot be revoked' };
  }
  return baseRoleChangeChecks(ctx);
}
