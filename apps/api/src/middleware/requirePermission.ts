import type { RequestHandler } from 'express';
import { hasPermission, type PermissionCode } from '@onwa/shared';
import { forbidden, unauthorized } from '../lib/errors.js';

export function requirePermission(permission: PermissionCode): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) return next(unauthorized());
    if (!hasPermission(req.auth.permissions, permission)) return next(forbidden());
    next();
  };
}
