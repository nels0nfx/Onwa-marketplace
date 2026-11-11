# Architecture

Modular monolith in an npm-workspaces monorepo.

```
Browser ──> apps/web (Next.js, Vercel)
              │  session cookies (Supabase anon key only)
              ├──> Supabase Auth (sign-in, sessions)
              └──> apps/api (Express, Render)  Authorization: Bearer <Supabase access token>
                        │  service_role key (server only)
                        └──> Supabase PostgreSQL (RLS + SQL functions)
```

- **Web** never holds the service-role key. It forwards the user's access token to the API from the server (never from browser JS).
- **API** verifies the token with Supabase Auth, loads profile + effective permissions through `get_user_access`, then authorizes per route with `requirePermission`. Role changes call SQL functions that re-check authorization and write the audit log atomically.
- **Shared** holds the role/permission catalogue and zod schemas. A test fails if it drifts from the SQL seed.
- **Future modules** (catalog, orders, payments, ledger, ...) are added as `apps/api/src/modules/<name>/` (routes + repository), new migrations `0008+`, and new `apps/web/src/app/...` routes. No restructure needed.

API modules in v0.1.0: `health`, `users` (`/me`), `admin` (users, roles, audit logs). Dependency injection (`AppDeps`) keeps I/O swappable in tests.

## Endpoints (`/api/v1`)

| Method & path | Auth | Permission |
|---|---|---|
| GET `/health` | none | none |
| GET `/me` | token | any signed-in active user |
| PATCH `/me` | token | own profile; body `fullName`, `phone` only |
| GET `/admin/users?q&limit&offset` | token | `customers.read` |
| GET `/admin/roles` | token | `roles.read` |
| GET `/admin/audit-logs` | token | `audit.read` |
| POST `/admin/users/:id/roles` `{role}` | token | `roles.assign` |
| DELETE `/admin/users/:id/roles/:role` | token | `roles.assign` |

Errors: `{ "error": { "code", "message", "requestId", "details?" } }`.
