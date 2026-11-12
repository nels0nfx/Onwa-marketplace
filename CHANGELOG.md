# Changelog

## 0.2.0 - Stage 2: Customers and sellers
- Added: delivery addresses; seller applications with private document uploads and a staff review workflow; approval that creates seller, storefront and role; public storefronts and directory; follow store; seller dashboard (store details, logo, cover); admin seller pages (review, suspend, reinstate).
- Database: migrations 0008 to 0010; SQL tests 002.
- API: new modules `addresses`, `sellers`, `stores`; `RATE_LIMIT_USER_WRITES_PER_MIN`.
- Fixes carried over from v0.1.0 live deployment: Supabase cookie typing, account page redirect loop, API request logging and database error logging, Render build installs dev dependencies.

## 0.1.0 - Stage 1: Foundation
Auth, profiles, roles and permissions, RLS, audit log, design system, admin accounts page.
