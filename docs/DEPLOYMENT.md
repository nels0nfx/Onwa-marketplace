# Deployment

Use separate Supabase projects (and env values) for staging and production.

**Database**: apply migrations 0001-0010 to each project. Migration 0010 creates the `seller-documents` (private) and `store-media` (public) storage buckets; confirm both exist under Storage afterwards.

**API on Render**: use `render.yaml` (Blueprint) or create a Node web service: build `npm install && npm run build:shared && npm run build -w @onwa/api`, start `npm run start -w @onwa/api`, health check `/api/v1/health`. Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CORS_ORIGINS=https://your-site`, `TRUST_PROXY_HOPS=1`, `NODE_ENV=production`.

**Web on Vercel**: import the repo, set *Root Directory* to `apps/web` (keep "Include source files outside of the Root Directory" on). `apps/web/vercel.json` runs the monorepo install/build. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`, `API_BASE_URL` (the Render URL).

**Supabase Auth**: Site URL = web URL; Redirect URLs include `<web>/auth/callback`; email confirmation on; min password 10 with upper, lower, digit. Configure a real SMTP provider (for example Resend) for production email.

**First admin**: see README.
