# Security (v0.1.0)

Implemented: deny-by-default RLS and grants; server-side permission checks on every admin route and SQL-level re-checks on role changes; role escalation guards (no self-change, super_admin only by super_admin, last super_admin protected, customer base role protected); sign-up cannot request roles via metadata; append-only audit log; zod validation with strict schemas; PostgREST filter sanitising; open-redirect protection; helmet, CORS allow-list, 100kb body limit, rate limits (global and per-admin-user writes); log redaction; no-enumeration login/reset messages; security headers on the web app; secret scanner in CI and in the release script.

Stage 2 additions: private KYC bucket with owner-folder and staff-read storage policies; signed document URLs expire after 5 minutes; file type verified by content, not by browser MIME; document and media paths validated server-side; reviewers cannot review their own application and only staff with `sellers.review` can decide; storefront text is rendered as plain text (no HTML, scripts or custom CSS; accent colours come from a fixed list); public endpoints expose only public store fields of active sellers; per-user write rate limit.

Stage 3 additions: stock and listing state can only change through audited database functions or triggers (clients and the browser cannot write them); inventory ledger is append-only; sellers are scoped by session-derived seller id on every route; public product responses omit exact stock and SKUs; uploaded product image paths are validated (folder, generated name, extension) and files verified by content type; moderators cannot review their own seller listings.

Stage 4 additions: prices, totals and availability are computed in the database at checkout (the browser sends only variant ids, quantities, an address id and an idempotency key); stock reservation is atomic and cannot oversell; no code path can mark an order paid except the internal function reserved for the verified payment webhook; order items and history are append-only; sellers cannot see unpaid orders or customer contact details before payment; order actions are validated by the database for each actor; buyers cannot buy their own products.

Known gaps / required before production:
- Reservation expiry runs when people check out or view orders and from the staff button. There is no scheduler yet; add a Render cron job calling `expire_unpaid_orders` before launch (Stage 5/10).
- Several unpaid orders can hold stock for 30 minutes each; add per-user limits on open unpaid orders before launch.
- Product images are public-read (random file names); draft images are reachable by anyone who has the URL.
- No automated content/prohibited-item screening: moderation is manual.
- Uploaded files are not virus-scanned. Add scanning (for example a Supabase Edge Function or third-party scanner) before relying on uploads at scale.
- Orphaned files can remain in storage if a user uploads and then abandons a flow; add a cleanup job.
- Bank account numbers are plain text columns (see DATABASE.md).
- Rate limiting is in-memory (single API instance). Use a shared store before scaling out.
- No strict Content-Security-Policy yet (needs nonce work); add in a later stage.
- Supabase Auth abuse protection (CAPTCHA, per-IP limits) must be configured in the Supabase dashboard.
- No MFA for staff yet; strongly recommended before staff accounts handle finance (Stage 5+).
- Backups: enable Supabase PITR/daily backups on the production project and test a restore. Document the drill in this file once done.
- Incident response and key-rotation runbooks are not yet written.

Secrets: the service-role key exists only in the API environment. Rotate it immediately if ever exposed. `npm run check:secrets` must pass before every release.

No security certification or audit is claimed.
