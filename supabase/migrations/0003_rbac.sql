-- ONWA 0003: roles, permissions and user-role assignments.
-- Keep the seed blocks in sync with packages/shared/src/{roles,permissions}.ts
-- (packages/shared/src/rbac.test.ts enforces this).

create table public.roles (
  id smallint generated always as identity primary key,
  code text not null unique check (code ~ '^[a-z][a-z_]{1,48}$'),
  name text not null,
  is_staff boolean not null default false,
  description text not null default '',
  created_at timestamptz not null default now()
);

create table public.permissions (
  id smallint generated always as identity primary key,
  code text not null unique check (code ~ '^[a-z][a-z_.]{1,63}$'),
  description text not null,
  created_at timestamptz not null default now()
);

create table public.role_permissions (
  role_id smallint not null references public.roles (id) on delete cascade,
  permission_id smallint not null references public.permissions (id) on delete cascade,
  primary key (role_id, permission_id)
);

create table public.user_roles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role_id smallint not null references public.roles (id) on delete restrict,
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

create index user_roles_role_id_idx on public.user_roles (role_id);

-- BEGIN roles seed
insert into public.roles (code, name, is_staff, description) values
  ('customer', 'Customer', false, 'Default role for every registered account.'),
  ('seller', 'Seller', false, 'Approved marketplace seller. Granted only through seller approval.'),
  ('delivery_partner', 'Delivery partner', false, 'Courier or rider assigned to deliveries.'),
  ('super_admin', 'Super admin', true, 'Full platform access, including role management.'),
  ('finance_manager', 'Finance manager', true, 'Payments, commissions, withdrawals and refunds.'),
  ('seller_manager', 'Seller manager', true, 'Seller applications, sellers and stores.'),
  ('customer_support', 'Customer support', true, 'Customer accounts, orders and support tickets.'),
  ('content_moderator', 'Content moderator', true, 'Listings, reviews and messaging moderation.'),
  ('dispute_manager', 'Dispute manager', true, 'Dispute handling and resolution.'),
  ('operations_manager', 'Operations manager', true, 'Orders, delivery, promotions and reports.');
-- END roles seed

-- BEGIN permissions seed
insert into public.permissions (code, description) values
  ('admin.access', 'Open the administration area'),
  ('customers.read', 'View customer profiles'),
  ('customers.manage', 'Edit or suspend customer accounts'),
  ('sellers.read', 'View seller applications and sellers'),
  ('sellers.review', 'Review and decide seller applications'),
  ('sellers.manage', 'Suspend or reinstate sellers and stores'),
  ('catalog.moderate', 'Approve or reject product, digital and service listings'),
  ('categories.manage', 'Manage categories and attributes'),
  ('orders.read', 'View orders'),
  ('orders.manage', 'Change order and delivery states on behalf of the platform'),
  ('delivery.manage', 'Manage delivery partners and shipments'),
  ('payments.read', 'View payments and payment events'),
  ('finance.ledger.read', 'View the financial ledger and reconciliation'),
  ('commissions.manage', 'Manage commission rules'),
  ('withdrawals.review', 'Approve or reject seller withdrawals'),
  ('refunds.manage', 'Create and approve refunds'),
  ('disputes.manage', 'Resolve disputes'),
  ('messaging.moderate', 'Moderate buyer-seller messages'),
  ('reviews.moderate', 'Moderate reviews'),
  ('promotions.manage', 'Manage promotions and coupons'),
  ('reports.read', 'View analytics and reports'),
  ('support.manage', 'Handle customer support tickets'),
  ('staff.read', 'View staff accounts'),
  ('roles.read', 'View roles, permissions and role assignments'),
  ('roles.assign', 'Grant and revoke roles'),
  ('settings.manage', 'Change platform settings'),
  ('audit.read', 'View audit logs');
-- END permissions seed

-- super_admin receives every permission that exists. Future migrations that add
-- permissions must also grant them to super_admin (a SQL test enforces this).
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.code = 'super_admin';

-- BEGIN role_permissions seed
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from (values
  ('finance_manager', 'admin.access'),
  ('finance_manager', 'payments.read'),
  ('finance_manager', 'finance.ledger.read'),
  ('finance_manager', 'commissions.manage'),
  ('finance_manager', 'withdrawals.review'),
  ('finance_manager', 'refunds.manage'),
  ('finance_manager', 'orders.read'),
  ('finance_manager', 'reports.read'),
  ('seller_manager', 'admin.access'),
  ('seller_manager', 'sellers.read'),
  ('seller_manager', 'sellers.review'),
  ('seller_manager', 'sellers.manage'),
  ('seller_manager', 'catalog.moderate'),
  ('seller_manager', 'reports.read'),
  ('customer_support', 'admin.access'),
  ('customer_support', 'customers.read'),
  ('customer_support', 'orders.read'),
  ('customer_support', 'support.manage'),
  ('content_moderator', 'admin.access'),
  ('content_moderator', 'catalog.moderate'),
  ('content_moderator', 'categories.manage'),
  ('content_moderator', 'reviews.moderate'),
  ('content_moderator', 'messaging.moderate'),
  ('dispute_manager', 'admin.access'),
  ('dispute_manager', 'disputes.manage'),
  ('dispute_manager', 'orders.read'),
  ('dispute_manager', 'messaging.moderate'),
  ('operations_manager', 'admin.access'),
  ('operations_manager', 'orders.read'),
  ('operations_manager', 'orders.manage'),
  ('operations_manager', 'delivery.manage'),
  ('operations_manager', 'promotions.manage'),
  ('operations_manager', 'reports.read')
) as m (role_code, permission_code)
join public.roles r on r.code = m.role_code
join public.permissions p on p.code = m.permission_code;
-- END role_permissions seed
