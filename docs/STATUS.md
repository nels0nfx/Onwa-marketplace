# Status: v0.2.0 (Stage 2)

Legend: VERIFIED = inspected and relevant tests executed and passed. PARTIAL / MISSING / UNABLE TO VERIFY as defined in the project brief.

## Evidence from the live deployment (reported by the owner)
- Stage 1 migrations 0001-0007 applied in Supabase without errors; web build succeeded on Vercel; API running on Render; sign-in works; account page shows profile and the Super admin role; the home page renders correctly on a phone in dark mode.
- Not yet reported: SQL test files 001 and 002, the admin pages, anything from Stage 2.

## Requirements
| Area | Status | Evidence / remaining work |
|---|---|---|
| Customer authentication, profiles, roles | PARTIAL | Working live (owner screenshots). SQL test 001 not reported as run. |
| Customer addresses | PARTIAL | Migration 0008, API `modules/addresses`, page `/account/addresses`. Pure validation tested (executed). SQL and route tests written, not executed. |
| Seller applications and approval | PARTIAL | Migration 0009 (workflow in SQL), API `modules/sellers`, pages `/sell/apply`, `/admin/sellers`. Workflow rules and schemas tested (executed). SQL test 002 and route tests written, not executed. |
| Private document storage | PARTIAL | Migration 0010 bucket + policies; upload flow in `sell/apply/actions.ts`. Never exercised against real Supabase Storage. File-type sniffing tested (executed). |
| Seller dashboard and storefronts | PARTIAL | `/seller`, `/store/[slug]`, `/stores`. Never rendered in a build. Listings, ratings, collections, contact seller: MISSING (later stages). |
| Server-side authorization | PARTIAL | Permission gates on every Stage 2 route; route tests written, not executed. |
| RLS / private storage policies | PARTIAL | Reviewed by hand; SQL tests written, not executed. |
| Audit logs | PARTIAL | Written inside SQL functions for submit, review, status change. Not executed. |
| Notifications (approval, rejection emails) | MISSING | Stage 8. Applicants see status on `/sell/apply`. |
| Lockfile | MISSING | No network in the authoring sandbox; run `npm install` once and commit `package-lock.json`. |
| Everything else in the brief | MISSING | Stages 3-10. |

## Tests: what actually ran in the authoring sandbox
Executed and passed (TypeScript compiled with `tsc`, run with `node --test`):
- `packages/shared`: 39/39 (roles/permissions parity with SQL, access rules, validation, review workflow, file sniffing, address and application schemas, SQL status/state parity).
- `apps/api` env and logger tests: 7/7.
- Strict compile of `packages/shared` source and `apps/api/src/lib/dbErrors.ts`.
- Secret scanner (also negative-tested with a planted key).

Written but NOT executed (sandbox has no network, Postgres, Express or Next): `apps/api/src/app.test.ts`, `apps/api/src/stage2.test.ts`, `supabase/tests/001_rbac_rls.sql`, `supabase/tests/002_sellers_addresses.sql`, typecheck and build of `apps/api` and `apps/web`.

Expect small compile or runtime fixes on first deploy; send the Vercel/Render error text and they will be fixed.

## Risks to review
- Document upload and storage policies are the most novel, least proven part of this release.
- Approval is one SQL transaction (seller + store + role); unproven until SQL test 002 runs.
- Bank details are plain-text columns; encrypt before enabling payouts.
- No virus scanning on uploads.
