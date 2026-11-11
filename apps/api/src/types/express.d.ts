import type { PermissionCode, Profile, RoleCode } from '@onwa/shared';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      auth?: {
        userId: string;
        email: string | null;
        profile: Profile;
        roles: RoleCode[];
        permissions: PermissionCode[];
      };
    }
  }
}

export {};
