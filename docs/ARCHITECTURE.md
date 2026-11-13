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

## Stage 2 endpoints (`/api/v1`)

| Method & path | Auth | Permission / rule |
|---|---|---|
| GET/POST `/me/addresses`, PUT/DELETE `/me/addresses/:id` | token | own addresses only |
| GET/PUT `/seller/application` | token | own application; PUT only while draft or more_info_required; sellers cannot re-apply |
| POST `/seller/application/submit` | token | checks completeness in SQL |
| POST/DELETE `/seller/application/documents` | token | file path must be `<userId>/<applicationId>/<uuid>.ext` and exist in storage |
| GET/PUT `/seller/store`, POST `/seller/store/media` | token | seller only; suspended sellers read-only |
| GET `/stores`, GET `/stores/:slug` | none | active sellers only; public fields only |
| POST/DELETE `/stores/:slug/follow`, GET `/me/follows` | token | own follows |
| GET `/admin/seller-applications[/:id]` | token | `sellers.read` (detail includes short-lived signed document URLs) |
| POST `/admin/seller-applications/:id/decision` | token | `sellers.review`; `start_review`, `request_info`, `approve`, `reject`; notes required for the last two |
| GET `/admin/sellers`, POST `/admin/sellers/:id/status` | token | `sellers.read` / `sellers.manage` |

Uploads: the website validates size and real file type (magic bytes), uploads to Supabase Storage with the user's own session (storage RLS limits them to their own folder), then asks the API to record the file. The API re-checks the path and that the object exists.

## Stage 3 endpoints (`/api/v1`)

| Method & path | Auth | Rule |
|---|---|---|
| GET `/categories`, GET `/products`, GET `/products/:slug` | none | approved products of active sellers only; filters: q, category, store, condition, price range (kobo), inStock, sort, paging |
| GET/POST `/seller/products`, GET/PUT `/seller/products/:id` | token | seller id comes from the session; edits blocked in review/archived |
| POST `/seller/products/:id/status` | token | `submit`, `withdraw`, `archive`, `restore` |
| POST `/seller/products/:id/variants`, PUT `/seller/variants/:id` | token | own products only |
| POST `/seller/variants/:id/stock` | token | reasons `restock`, `adjustment`, `correction`; never below zero |
| GET `/seller/products/:id/movements` | token | own stock history |
| POST/DELETE `/seller/products/:id/images[/:imageId]` | token | path must be `<sellerId>/<productId>/<uuid>.ext` and exist in storage |
| GET `/admin/products[/:id]`, POST `/admin/products/:id/decision` | token | `catalog.moderate`; `approve`, `request_changes`, `reject` |
| GET/POST `/admin/categories`, PUT `/admin/categories/:id` | token | `categories.manage` |
