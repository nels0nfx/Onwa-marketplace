-- OPTIONAL: lets the migrations and SQL tests run on a plain PostgreSQL 15+ database
-- that is NOT Supabase. Do NOT apply this to a Supabase project (it already has all of this).
--   createdb onwa_test
--   psql onwa_test -v ON_ERROR_STOP=1 -f supabase/tests/shim/local_auth_shim.sql
--   for f in supabase/migrations/*.sql; do psql onwa_test -v ON_ERROR_STOP=1 -f "$f"; done
--   psql onwa_test -v ON_ERROR_STOP=1 -f supabase/tests/001_rbac_rls.sql

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

grant anon, authenticated, service_role to current_user;
grant usage on schema public to anon, authenticated, service_role;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  raw_app_meta_data jsonb not null default '{}'::jsonb
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;
