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
| 0008_addresses | `addresses` with per-user default handling and a 10-address limit; `is_ng_state()` |
| 0009_sellers | `seller_applications`, `seller_application_documents`, `seller_application_events`, `sellers`, `stores`, `store_follows`; functions `save_seller_application`, `submit_seller_application`, `review_seller_application`, `set_seller_status`, `generate_store_slug`, `seller_application_missing` |
| 0010_storage | Buckets `seller-documents` (private, KYC) and `store-media` (public read, owner write) and their storage policies (skipped on plain Postgres) |

## Access model

| Table | anon | authenticated | service_role (API only) |
|---|---|---|---|
| profiles | none | select own, or all with `customers.read`; update own `full_name, phone, avatar_url` only | full |
| roles / permissions / role_permissions | none | select with `roles.read` | full |
| user_roles | none | select own, or all with `roles.read`; no writes | full |
| audit_logs | none | select with `audit.read` | select, insert only |

Adding a permission later: add it to `permissions`, grant it to `super_admin`, and update `packages/shared/src/{permissions,roles}.ts` (tests enforce parity).

Money rule for later stages: integer kobo only, never floats.

## Stage 2 access model

| Table | anon | authenticated | service_role (API only) |
|---|---|---|---|
| addresses | none | full CRUD on own rows only; cannot change `user_id` | full |
| seller_applications / documents / events | none | select own; staff with `sellers.read` select all; no writes | full |
| sellers / stores | none | select own (stores via their seller); staff with `sellers.read` select all; no writes | full |
| store_follows | none | select own | full |

Public storefront reads, follows and every seller/staff write go through the API. Review and status changes run only inside the SQL functions above, which re-check permissions, enforce the workflow, and write the audit log in the same transaction.

Application states: `draft`, `submitted`, `under_review`, `more_info_required`, `approved`, `rejected`. Seller account states: `active`, `suspended`. A rejected applicant may apply again (new application). One live application per user is enforced by a partial unique index.

Sensitive data: identity documents are private files (no ID number is collected). Bank account numbers are stored in `seller_applications` for verification and future payouts; they are never returned by public endpoints or lists, only to the applicant and to reviewers. Encrypt-at-rest relies on Supabase disk encryption; column-level encryption is a recommended hardening step before payouts go live.
