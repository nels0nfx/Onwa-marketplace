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
| 0011_catalog | `categories` (+ starter seed), `products`, `product_variants`, `product_images`, `product_events`, immutable `inventory_movements`; functions `create_product`, `add_variant`, `seller_change_product_status`, `review_product`, `apply_stock_movement`, `seller_adjust_stock`, `product_missing`, `create_category`, `update_category`; triggers for re-review, image rules and price/stock rollups |
| 0013_commerce | `carts`, `cart_items`, `orders`, `seller_orders`, `order_items` (immutable), `order_status_history` (immutable); functions `cart_add_item`, `cart_set_quantity`, `create_order`, `change_order_status`, `mark_order_paid` (internal), `expire_unpaid_orders` |
| 0012_catalog_storage | Public `product-media` bucket; owner-only write policies (skipped on plain Postgres) |
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

## Stage 3 notes

- **Money** is `bigint` kobo (check: 1 to 10,000,000,000 = ₦100 million). The website converts typed naira to kobo with integer string maths, never floats.
- **No overselling**: `apply_stock_movement` is one atomic `UPDATE ... WHERE stock_quantity + delta >= 0` plus a ledger row; a `CHECK (stock_quantity >= 0)` is the last line of defence. Checkout (Stage 4) will call it with reason `sale`.
- **Review rules live in triggers**: no edits while awaiting review or archived; options are immutable; editing content of a live listing, or changing its images, returns it to `pending_review` and removes it from the catalogue until re-approved.
- **Rollups**: `products.price_from_kobo` and `total_stock` are maintained by trigger from active variants, so the catalogue can sort and filter by price and stock.
- **Access**: authenticated users can read only their own seller's catalogue rows (and staff with `catalog.moderate` can read all); everything public goes through the API, which only returns approved products of active sellers and never exposes exact stock or SKUs.
- Free-form `attributes` (key/value text) are used instead of per-category attribute definitions; defining attributes per category is a later improvement.

## Stage 4 notes

- **Reservation, not payment**: `create_order` reserves stock through `apply_stock_movement` (reason `sale`) inside the same transaction that creates the order, items and history. A short item raises `insufficient stock` and nothing is created. `change_order_status('cancel')` and `expire_unpaid_orders()` return stock with reason `cancellation`; a cancelled order cannot be cancelled again.
- **Idempotency**: `unique (buyer_id, idempotency_key)`. Replaying the same checkout returns the existing order and does not reserve stock twice.
- **Snapshots**: `order_items` stores name, option label, SKU, image and the unit price actually charged, and cannot be updated or deleted. `orders.shipping_address` is a JSON copy of the chosen address, so later address edits do not change history.
- **Money**: kobo integers, with `total = subtotal + shipping` and `line_total = unit * quantity` enforced by CHECK constraints. Shipping is 0 until Stage 8.
- **Payment boundary**: only `mark_order_paid(order, reference)` can move an order to `paid`; it is executable by `service_role` only and has no API route. Stage 5 calls it from the verified webhook. It refuses orders that are already paid or cancelled (late payments after expiry will be handled by the Stage 5 refund flow).
- **Visibility**: buyers read their own orders; sellers read a seller order only when `paid_at is not null`; staff with `orders.read` read all. Customer address and phone reach a seller only through the API and only for paid orders.
- **Workflow actors** (enforced in `change_order_status`): buyer or staff cancel unpaid; seller or staff move paid orders through processing, ready, dispatched, in transit, delivered; buyer or staff confirm receipt; only the buyer can request a return, within 7 days of delivery. Staff actions are written to the audit log.
