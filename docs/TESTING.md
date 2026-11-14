# Testing

| Suite | Location | Run |
|---|---|---|
| Shared unit tests (roles, permissions, access rules, validation, SQL-seed parity) | `packages/shared/src/*.test.ts` | `npm run test:shared` |
| API unit tests (env, logger) | `apps/api/src/**/*.test.ts` | `npm test -w @onwa/api` |
| API route tests (auth, authorization, validation, rate limit, CORS) | `apps/api/src/app.test.ts`, `apps/api/src/stage2.test.ts`, `apps/api/src/stage3.test.ts`, `apps/api/src/stage4.test.ts` | same |
| SQL tests (RLS, grants, triggers, audit immutability, role functions) | `supabase/tests/001_rbac_rls.sql`, `supabase/tests/002_sellers_addresses.sql` (Stage 2), `supabase/tests/003_catalog.sql` (Stage 3), `supabase/tests/004_orders.sql` (Stage 4) | `psql -v ON_ERROR_STOP=1 -f ...` (see file header; CI job `sql` runs it on Postgres 15 with a small auth shim) |

The tests use Node's built-in runner through `tsx`. Execution status for each release is recorded in [STATUS.md](STATUS.md); a test file existing is not evidence it passed.
