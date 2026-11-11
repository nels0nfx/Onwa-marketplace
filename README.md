# ONWA Unified Marketplace

**One marketplace. Endless possibilities.**

ONWA is a Nigerian multi-vendor marketplace for physical products, digital downloads and services (default currency NGN). This repository is built in stages. **This is release v0.1.0, Stage 1: Foundation.**

## What v0.1.0 contains

- Monorepo: `apps/web` (Next.js 15, TypeScript), `apps/api` (Node.js/Express modular monolith, `/api/v1`), `packages/shared` (roles, permissions, validation), `supabase/` (migrations and SQL tests).
- Supabase Auth: register, email confirmation, sign in, sign out, forgot/reset password.
- Profiles created by a database trigger; every new user gets only the `customer` role (roles are never read from client metadata).
- RBAC: 10 roles, 27 permissions, audited role grant/revoke, one-time super-admin bootstrap, last-super-admin protection.
- Deny-by-default Row Level Security, column-level update grants, append-only audit log.
- API: `GET /health`, `GET/PATCH /me`, admin users/roles/audit endpoints, rate limiting, helmet, CORS allow-list, validation.
- Luxury design system (obsidian `#111111`, ivory `#F7F5F0`, champagne gold `#B58B45`, white) with light and dark themes; home, auth, account and admin pages.

Not in v0.1.0 (later stages): sellers, catalog, cart, orders, payments, ledger, delivery, messaging, reviews. Public navigation links for those arrive with their stages so no button ever points at nothing. See [docs/STATUS.md](docs/STATUS.md) for the honest verification status.

## Structure

```
apps/web          Next.js site (talks to Supabase Auth + the API)
apps/api          REST API, service-role key lives ONLY here
packages/shared   Roles, permissions, zod schemas, access rules (used by web and api)
supabase/         config.toml, migrations/0001-0007, tests/ (SQL)
scripts/          check-secrets, release zip, Termux helper
docs/             Architecture, database, security, deployment, Termux, testing, compliance, status
```

## Setup

1. **Supabase project**: create one at supabase.com. In *Authentication > Providers > Email* turn on email confirmation and set minimum password length 10. In *URL Configuration* set Site URL to your website URL and add `<site>/auth/callback` to Redirect URLs.
2. **Database**: apply `supabase/migrations/0001..0007` in order (Supabase CLI `supabase db push`, or paste each file into the SQL Editor in order).
3. **Environment**: see `.env.example`. API needs `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CORS_ORIGINS`. Web needs `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`, `API_BASE_URL`.
4. **Install and run** (on a computer or CI; see Termux notes):
   ```
   npm install
   npm run dev:api      # http://localhost:4000
   npm run dev:web      # http://localhost:3000
   ```
5. **First admin**: register on the site and confirm your email, then run
   `npm run admin:bootstrap -- you@example.com` (needs the API `.env`). It refuses to run once any super admin exists. Sign out and in again.

## Commands

| Command | Purpose |
|---|---|
| `npm run build` | build shared, api, web |
| `npm test` | shared + api tests |
| `npm run typecheck` | typecheck all workspaces |
| `npm run check:secrets` | scan for committed secrets / service-role leakage |
| `npm run release:zip` | create `../ONWA-v<version>.zip` |

## Android / Termux

Termux is for receiving ZIPs, committing and pushing. Builds and deploys run on GitHub Actions, Vercel and Render. Full steps: [docs/TERMUX.md](docs/TERMUX.md).

## Documentation

[Architecture](docs/ARCHITECTURE.md) · [Database](docs/DATABASE.md) · [Security](docs/SECURITY.md) · [Deployment](docs/DEPLOYMENT.md) · [Testing](docs/TESTING.md) · [Compliance notes](docs/COMPLIANCE.md) · [Status](docs/STATUS.md)
