/**
 * Permission catalogue. MUST stay in sync with supabase/migrations/0003_rbac.sql
 * (the "permissions seed" block). rbac.test.ts fails if they drift.
 */
export const PERMISSIONS = {
  'admin.access': 'Open the administration area',
  'customers.read': 'View customer profiles',
  'customers.manage': 'Edit or suspend customer accounts',
  'sellers.read': 'View seller applications and sellers',
  'sellers.review': 'Review and decide seller applications',
  'sellers.manage': 'Suspend or reinstate sellers and stores',
  'catalog.moderate': 'Approve or reject product, digital and service listings',
  'categories.manage': 'Manage categories and attributes',
  'orders.read': 'View orders',
  'orders.manage': 'Change order and delivery states on behalf of the platform',
  'delivery.manage': 'Manage delivery partners and shipments',
  'payments.read': 'View payments and payment events',
  'finance.ledger.read': 'View the financial ledger and reconciliation',
  'commissions.manage': 'Manage commission rules',
  'withdrawals.review': 'Approve or reject seller withdrawals',
  'refunds.manage': 'Create and approve refunds',
  'disputes.manage': 'Resolve disputes',
  'messaging.moderate': 'Moderate buyer-seller messages',
  'reviews.moderate': 'Moderate reviews',
  'promotions.manage': 'Manage promotions and coupons',
  'reports.read': 'View analytics and reports',
  'support.manage': 'Handle customer support tickets',
  'staff.read': 'View staff accounts',
  'roles.read': 'View roles, permissions and role assignments',
  'roles.assign': 'Grant and revoke roles',
  'settings.manage': 'Change platform settings',
  'audit.read': 'View audit logs',
} as const;

export type PermissionCode = keyof typeof PERMISSIONS;
export const PERMISSION_CODES = Object.keys(PERMISSIONS) as PermissionCode[];

export function isPermissionCode(value: unknown): value is PermissionCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PERMISSIONS, value);
}
