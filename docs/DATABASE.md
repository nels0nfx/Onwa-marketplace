# Database (Supabase PostgreSQL)

Migrations in `supabase/migrations`, applied in order. Never edit an applied migration; add a new one.

| File | Purpose |
|---|---|
| 0001_foundation | `set_updated_at`, default privileges revoked from anon/authenticated |
| 0002_profiles | `profiles` (1:1 with `auth.users`) |
| 0003_rbac | `roles`, `permissions`, `role_permissions`, `user_roles` + seeds |
| 0004_audit_logs | append-only `audit_logs`, `write_audit_log` |
| 0005_auth_triggers | profile + `customer` role on sign-up; email sync |
| 0006_rbac_functions | `has_permission`, `get_user_access`, `admin_assign_role`, `admin_revoke_role`, `bootstrap_super_admin`, last-super-admin guard |
| 0007_rls_and_grants | RLS enabled everywhere, policies, grants, function privileges |

## Access model

| Table | anon | authenticated | service_role (API only) |
|---|---|---|---|
| profiles | none | select own, or all with `customers.read`; update own `full_name, phone, avatar_url` only | full |
| roles / permissions / role_permissions | none | select with `roles.read` | full |
| user_roles | none | select own, or all with `roles.read`; no writes | full |
| audit_logs | none | select with `audit.read` | select, insert only |

Adding a permission later: add it to `permissions`, grant it to `super_admin`, and update `packages/shared/src/{permissions,roles}.ts` (tests enforce parity).

Money rule for later stages: integer kobo only, never floats.
