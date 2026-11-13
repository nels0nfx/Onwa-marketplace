# Status: v0.3.0 (Stage 3)

Legend: VERIFIED = inspected and relevant tests executed and passed. PARTIAL / MISSING / UNABLE TO VERIFY as defined in the project brief.

## Evidence from the live deployment (reported by the owner)
- Stage 1 and Stage 2 deployed to Vercel, Render and Supabase. Sign-in, account page, roles and the home page were observed working. A Vercel type error in Stage 2 (`PUT` not allowed in the API helper) was reported and fixed in this release.
- Not yet reported: Stage 2 migrations 0008-0010 applied, Stage 2 pages in use, and anything from Stage 3.

## Requirements
| Area | Status | Evidence / remaining work |
|---|---|---|
| Physical catalogue (products, variants, attributes, weight/dimensions, images) | PARTIAL | Migration 0011, API `modules/catalog`, seller pages `/seller/products`. Validation, money and options logic tested (executed). SQL and route tests written, not executed. |
| Categories | PARTIAL | Seeded + admin manager. Two levels. Per-category attribute definitions: MISSING. |
| Inventory and no-overselling | PARTIAL | `apply_stock_movement` (atomic UPDATE + CHECK + immutable ledger). Logic tested in SQL test 003 (written, not executed). Concurrency under load not tested. |
| Product approval workflow | PARTIAL | Seller and moderator state machines tested (executed) and mirrored in SQL; SQL test written, not executed. Configurable approval switch: MISSING (Stage 9). |
| Public browsing, search, filters, product pages | PARTIAL | `/products`, `/product/<slug>`, store grids. Never rendered in a build. No full-text search (ilike only). |
| Private/ public storage policies for product images | PARTIAL | Migration 0012; upload flow never exercised against real Storage. |
| Cart, checkout, orders | MISSING | Stage 4. |
| Notifications for listing decisions | MISSING | Stage 8. |
| Lockfile | MISSING | No network in the authoring sandbox; run `npm install` once and commit `package-lock.json`. |
| Everything else in the brief | MISSING | Stages 4-10. |

## Tests: what actually ran in the authoring sandbox
Executed and passed (TypeScript compiled with `tsc`, run with `node --test`):
- `packages/shared`: 54/54 (roles/permissions parity with SQL, access rules, validation, seller workflow, catalogue money/options/status machines, schemas, file sniffing, SQL parity checks).
- `apps/api` env and logger tests: 7/7.
- Secret scanner.

Written but NOT executed (no network, Postgres, Express or Next in the sandbox): `apps/api/src/app.test.ts`, `stage2.test.ts`, `stage3.test.ts`; `supabase/tests/001`, `002`, `003`; typecheck and build of `apps/api` and `apps/web`.

Expect a few small compile or runtime fixes on first deploy; send the Vercel/Render error text and they will be fixed before Stage 4.

## Risks to review
- Stock and listing state are enforced by database functions/triggers that have never run; run SQL test 003 on a throwaway project before trusting them.
- Product image uploads share the untested storage flow introduced in Stage 2.
- Draft product images are in a public bucket (random names); acceptable for now, noted in SECURITY.md.
