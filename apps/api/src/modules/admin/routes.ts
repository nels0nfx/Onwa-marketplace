import { Router } from 'express';
import type { RequestHandler } from 'express';
import {
  canAssignRole, canRevokeRole, listAuditQuerySchema, listUsersQuerySchema, roleChangeSchema, uuidSchema,
  isRoleCode,
} from '@onwa/shared';
import type { AppDeps } from '../../deps.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { requirePermission } from '../../middleware/requirePermission.js';
import { parseOrThrow } from '../../middleware/validate.js';
import { badRequest, forbidden, unauthorized } from '../../lib/errors.js';

/** Administrative routes. Every handler is gated by an explicit permission; the browser is never trusted. */
export function adminRoutes(deps: Pick<AppDeps, 'users'>, limits: { adminWrites: RequestHandler }): Router {
  const router = Router();

  router.get(
    '/admin/users',
    requirePermission('customers.read'),
    asyncHandler(async (req, res) => {
      const query = parseOrThrow(listUsersQuerySchema, req.query);
      const page = await deps.users.listUsers({ ...(query.q ? { q: query.q } : {}), limit: query.limit, offset: query.offset });
      res.json(page);
    }),
  );

  router.get(
    '/admin/roles',
    requirePermission('roles.read'),
    asyncHandler(async (_req, res) => {
      res.json({ roles: await deps.users.listRoles() });
    }),
  );

  router.get(
    '/admin/audit-logs',
    requirePermission('audit.read'),
    asyncHandler(async (req, res) => {
      const query = parseOrThrow(listAuditQuerySchema, req.query);
      res.json(await deps.users.listAuditLogs(query));
    }),
  );

  router.post(
    '/admin/users/:userId/roles',
    requirePermission('roles.assign'),
    limits.adminWrites,
    asyncHandler(async (req, res) => {
      if (!req.auth) throw unauthorized();
      const targetId = parseOrThrow(uuidSchema, req.params.userId);
      const { role } = parseOrThrow(roleChangeSchema, req.body);
      const decision = canAssignRole({
        actorId: req.auth.userId, targetId, actorRoles: req.auth.roles, actorPermissions: req.auth.permissions, role,
      });
      if (!decision.allowed) throw forbidden(decision.reason);
      await deps.users.assignRole(req.auth.userId, targetId, role);
      res.status(204).end();
    }),
  );

  router.delete(
    '/admin/users/:userId/roles/:role',
    requirePermission('roles.assign'),
    limits.adminWrites,
    asyncHandler(async (req, res) => {
      if (!req.auth) throw unauthorized();
      const targetId = parseOrThrow(uuidSchema, req.params.userId);
      const role = req.params.role;
      if (!isRoleCode(role)) throw badRequest('Unknown role');
      const decision = canRevokeRole({
        actorId: req.auth.userId, targetId, actorRoles: req.auth.roles, actorPermissions: req.auth.permissions, role,
      });
      if (!decision.allowed) throw forbidden(decision.reason);
      await deps.users.revokeRole(req.auth.userId, targetId, role);
      res.status(204).end();
    }),
  );

  return router;
}
