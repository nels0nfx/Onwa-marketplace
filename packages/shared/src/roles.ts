import { PERMISSION_CODES, type PermissionCode } from './permissions.js';

export const ROLE_CODES = [
  'customer',
  'seller',
  'delivery_partner',
  'super_admin',
  'finance_manager',
  'seller_manager',
  'customer_support',
  'content_moderator',
  'dispute_manager',
  'operations_manager',
] as const;

export type RoleCode = (typeof ROLE_CODES)[number];

export interface RoleDefinition {
  name: string;
  isStaff: boolean;
  description: string;
}

/** Mirrors the "roles seed" block in supabase/migrations/0003_rbac.sql. */
export const ROLE_DEFINITIONS: Record<RoleCode, RoleDefinition> = {
  customer: { name: 'Customer', isStaff: false, description: 'Default role for every registered account.' },
  seller: { name: 'Seller', isStaff: false, description: 'Approved marketplace seller. Granted only through seller approval.' },
  delivery_partner: { name: 'Delivery partner', isStaff: false, description: 'Courier or rider assigned to deliveries.' },
  super_admin: { name: 'Super admin', isStaff: true, description: 'Full platform access, including role management.' },
  finance_manager: { name: 'Finance manager', isStaff: true, description: 'Payments, commissions, withdrawals and refunds.' },
  seller_manager: { name: 'Seller manager', isStaff: true, description: 'Seller applications, sellers and stores.' },
  customer_support: { name: 'Customer support', isStaff: true, description: 'Customer accounts, orders and support tickets.' },
  content_moderator: { name: 'Content moderator', isStaff: true, description: 'Listings, reviews and messaging moderation.' },
  dispute_manager: { name: 'Dispute manager', isStaff: true, description: 'Dispute handling and resolution.' },
  operations_manager: { name: 'Operations manager', isStaff: true, description: 'Orders, delivery, promotions and reports.' },
};

/** Mirrors the "role_permissions seed" block in 0003_rbac.sql. super_admin receives every permission. */
export const ROLE_PERMISSIONS: Record<RoleCode, readonly PermissionCode[]> = {
  customer: [],
  seller: [],
  delivery_partner: [],
  super_admin: PERMISSION_CODES,
  finance_manager: ['admin.access', 'payments.read', 'finance.ledger.read', 'commissions.manage', 'withdrawals.review', 'refunds.manage', 'orders.read', 'reports.read'],
  seller_manager: ['admin.access', 'sellers.read', 'sellers.review', 'sellers.manage', 'catalog.moderate', 'reports.read'],
  customer_support: ['admin.access', 'customers.read', 'orders.read', 'support.manage'],
  content_moderator: ['admin.access', 'catalog.moderate', 'categories.manage', 'reviews.moderate', 'messaging.moderate'],
  dispute_manager: ['admin.access', 'disputes.manage', 'orders.read', 'messaging.moderate'],
  operations_manager: ['admin.access', 'orders.read', 'orders.manage', 'delivery.manage', 'promotions.manage', 'reports.read'],
};

export function isRoleCode(value: unknown): value is RoleCode {
  return typeof value === 'string' && (ROLE_CODES as readonly string[]).includes(value);
}

export function isStaffRole(role: RoleCode): boolean {
  return ROLE_DEFINITIONS[role].isStaff;
}
