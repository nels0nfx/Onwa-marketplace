-- ONWA 0001: foundation helpers and deny-by-default privilege baseline.
-- Every later migration must GRANT explicitly. Nothing is exposed to anon/authenticated by default.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- New tables, sequences and functions created in public by this role are NOT
-- automatically accessible to the API roles.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

revoke all on function public.set_updated_at() from public, anon, authenticated;
