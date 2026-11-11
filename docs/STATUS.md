# Status: v0.1.0 (Stage 1)

Legend: VERIFIED = inspected and relevant tests executed and passed. PARTIAL / MISSING / UNABLE TO VERIFY as defined in the project brief.

| Area | Status | Evidence / remaining work |
|---|---|---|
| Customer authentication | PARTIAL | `apps/web/src/app/(auth)/*`, `lib/supabase/*`. Written against Supabase SSR; never run against a live Supabase project. Validation schemas tested. |
| Profiles + roles + permissions (SQL) | PARTIAL | `supabase/migrations/0002-0006`. SQL never executed in the authoring sandbox. Tests written (`supabase/tests/001_rbac_rls.sql`) and wired into CI; not yet run. |
| RLS / deny-by-default | PARTIAL | `0007_rls_and_grants.sql` reviewed by hand; SQL test written, not executed. |
| Server-side authorization | PARTIAL | Route tests written (`app.test.ts`); not executed (Express not installable in sandbox). Pure access rules VERIFIED by executed unit tests. |
| Secrets management | VERIFIED (limited) | `scripts/check-secrets.mjs` executed and passes; service-role key referenced only in `apps/api` and docs. |
| Audit logs | PARTIAL | Append-only trigger + tests written, not executed. |
| Design system, light/dark, mobile-first UI | PARTIAL | Written; never rendered or built. Needs visual review on a phone. |
| Docs, `.env.example`, Termux guide, CI, deploy config | PARTIAL | Written; deployment never exercised. |
| Lockfile | MISSING | No network in sandbox. Run `npm install` once and commit `package-lock.json`. |
| Sellers, catalog, cart, orders, payments, ledger, delivery, messaging, reviews, support, backups drill | MISSING | Later stages (2-10). |

## Tests: what actually ran in the authoring sandbox

Executed and passed (compiled with `tsc`, run with `node --test`):
- `packages/shared`: 23/23 (roles/permissions parity with SQL seed, access rules, validation, redirects, phone, search sanitising).
- `apps/api` `config/env.test.ts` and `lib/logger.test.ts`: 7/7.
- Strict TypeScript compile of `packages/shared` source: clean.

Written but NOT executed (no network, no Postgres, no Express/Next in sandbox): `apps/api/src/app.test.ts` (route/auth/rate-limit/CORS), `supabase/tests/001_rbac_rls.sql`, TypeScript typecheck of `apps/api` and `apps/web`, `next build`, `npm install`.

Expect to fix small compile or runtime issues on first CI run. Send the Actions log back and they will be fixed before Stage 2.

## Critical risks to review before any later stage
- Payments and ledger: not started.
- Unauthorized access / data isolation: only accounts and roles exist so far; policies untested against a real database.
- Admin privilege escalation: guarded in app code and SQL; unproven until SQL and route tests run.
- Migrations: not yet applied to a real database.
- Production deployment: not attempted.
