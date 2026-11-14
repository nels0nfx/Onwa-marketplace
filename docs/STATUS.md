# Status: v0.4.0 (Stage 4)

Legend: VERIFIED = inspected and relevant tests executed and passed. PARTIAL / MISSING / UNABLE TO VERIFY as defined in the project brief.

## Evidence from the live deployment (reported by the owner)
- Stages 1 and 2 deployed (Vercel, Render, Supabase); sign-in, account page and roles observed working.
- Not yet reported: Stage 2 and Stage 3 migrations applied, Stage 2/3 pages in use, anything from Stage 4.

## Requirements
| Area | Status | Evidence / remaining work |
|---|---|---|
| Cart | PARTIAL | Migration 0013, API `modules/orders`, `/cart`. Validation tested (executed); SQL and route tests written, not executed. |
| Checkout (one seller per checkout, multi-seller ready) | PARTIAL | `create_order`, `/checkout/<store>`. Delivery fee is 0 until Stage 8. |
| Order workflows (physical) | PARTIAL | State machine tested (executed) and mirrored in SQL. Digital and service workflows: MISSING (Stages 6-7). Returned, refund pending, refunded: reserved for Stage 5. |
| Inventory on purchase and cancellation | PARTIAL | Atomic reservation, return on cancel/expiry; SQL test 004 written, not executed. Reservation expiry needs a scheduler (documented). |
| Order history pages | PARTIAL | `/orders`, `/seller/orders`, `/admin/orders`. Never rendered in a build. |
| Payments, commissions, ledger, withdrawals, refunds | MISSING | Stage 5. Orders cannot be paid yet, by design. |
| Delivery, tracking | MISSING | Stage 8. |
| Notifications | MISSING | Stage 8. |
| Lockfile | MISSING | No network in the authoring sandbox; run `npm install` once and commit `package-lock.json`. |
| Everything else in the brief | MISSING | Stages 5-10. |

## Tests: what actually ran in the authoring sandbox
Executed and passed (TypeScript compiled with `tsc`, run with `node --test`):
- `packages/shared`: 63/63 (adds order state machine, actor rules, return window, SQL parity, cart/checkout schemas).
- `apps/api` env and logger tests: 7/7.
- Secret scanner.

Written but NOT executed (no network, Postgres, Express or Next in the sandbox): `apps/api/src/app.test.ts`, `stage2.test.ts`, `stage3.test.ts`, `stage4.test.ts`; `supabase/tests/001` to `004`; typecheck and build of `apps/api` and `apps/web`.

Expect a few small compile or runtime fixes on first deploy; send the Vercel/Render error text and they will be fixed before Stage 5.

## Risks to review
- Checkout and cancellation move stock and money-adjacent data; run SQL test 004 on a throwaway Supabase project before trusting it.
- Concurrency (two buyers taking the last unit at once) is protected by one atomic UPDATE and a CHECK constraint but has not been load-tested.
- Open unpaid orders hold stock for 30 minutes; add per-user limits and a scheduler before launch.
