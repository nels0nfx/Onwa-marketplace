# Changelog

## 0.4.0 - Stage 4: Cart, checkout and orders
- Added: cart, checkout with idempotency, atomic stock reservation, parent/seller orders with immutable item snapshots, status history, physical order workflow, expiry of unpaid orders, buyer/seller/staff order pages, add to cart on product pages.
- Database: migration 0013; SQL tests 004.
- API: cart, checkout, orders, seller orders, admin orders.
- Deliberately not included: any way to mark an order paid (Stage 5), delivery fees (Stage 8), commissions (Stage 5).

## 0.3.0 - Stage 3: Catalogue and inventory
- Added: categories (managed by staff), physical products with variants, kobo pricing, images, attributes, shipping details; immutable inventory ledger with a no-oversell stock function; listing review workflow with automatic re-review of edited live listings; seller product pages; admin moderation queue and category manager; public `/products`, `/product/<slug>`, store product grids.
- Database: migrations 0011, 0012; SQL tests 003.
- API: catalogue modules (public, seller, admin).
- Fix: `PUT` is now allowed by the web API helper and API CORS.

## 0.2.0 - Stage 2: Customers and sellers
- Added: delivery addresses; seller applications with private document uploads and a staff review workflow; approval that creates seller, storefront and role; public storefronts and directory; follow store; seller dashboard (store details, logo, cover); admin seller pages (review, suspend, reinstate).
- Database: migrations 0008 to 0010; SQL tests 002.
- API: new modules `addresses`, `sellers`, `stores`; `RATE_LIMIT_USER_WRITES_PER_MIN`.
- Fixes carried over from v0.1.0 live deployment: Supabase cookie typing, account page redirect loop, API request logging and database error logging, Render build installs dev dependencies.

## 0.1.0 - Stage 1: Foundation
Auth, profiles, roles and permissions, RLS, audit log, design system, admin accounts page.
