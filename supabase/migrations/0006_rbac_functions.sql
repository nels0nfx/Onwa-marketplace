-- ONWA 0006: authorization helpers and audited role administration.

-- Core check. Internal: callable by service_role only (see grants in 0007).
create or replace function public.user_has_permission(p_user uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles pr
    join public.user_roles ur on ur.user_id = pr.id
    join public.role_permissions rp on rp.role_id = ur.role_id
    join public.permissions p on p.id = rp.permission_id
    where pr.id = p_user
      and pr.status = 'active'
      and p.code = p_permission
  );
$$;

create or replace function public.user_has_role(p_user uuid, p_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles pr
    join public.user_roles ur on ur.user_id = pr.id
    join public.roles r on r.id = ur.role_id
    where pr.id = p_user and pr.status = 'active' and r.code = p_role
  );
$$;

-- Caller-scoped checks used inside RLS policies. They can only ever answer about auth.uid().
create or replace function public.has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.user_has_permission(auth.uid(), p_permission);
$$;

create or replace function public.has_role(p_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.user_has_role(auth.uid(), p_role);
$$;

-- Roles and permissions for one user, for the API (service_role only).
create or replace function public.get_user_access(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'roles', coalesce((
      select jsonb_agg(r.code order by r.code)
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      where ur.user_id = p_user
    ), '[]'::jsonb),
    'permissions', coalesce((
      select jsonb_agg(distinct p.code order by p.code)
      from public.user_roles ur
      join public.role_permissions rp on rp.role_id = ur.role_id
      join public.permissions p on p.id = rp.permission_id
      where ur.user_id = p_user
    ), '[]'::jsonb)
  );
$$;

-- Prevent the platform from ever losing its last super_admin.
create or replace function public.guard_last_super_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.roles r where r.id = old.role_id and r.code = 'super_admin')
     and not exists (
       select 1
       from public.user_roles ur
       join public.roles r on r.id = ur.role_id
       where r.code = 'super_admin' and ur.user_id <> old.user_id
     )
  then
    raise exception 'cannot remove the last super_admin' using errcode = '23514';
  end if;
  return old;
end;
$$;

create trigger user_roles_guard_last_super_admin
  before delete on public.user_roles
  for each row execute function public.guard_last_super_admin();

-- Error codes: 42501 forbidden, P0002 not found, 22023 invalid input, 23514 integrity rule.
create or replace function public.admin_assign_role(p_actor uuid, p_target uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role_id smallint;
  v_rows integer;
begin
  if p_actor is null or p_target is null or p_role is null then
    raise exception 'actor, target and role are required' using errcode = '22023';
  end if;
  if not public.user_has_permission(p_actor, 'roles.assign') then
    raise exception 'missing permission roles.assign' using errcode = '42501';
  end if;
  if p_actor = p_target then
    raise exception 'you cannot change your own roles' using errcode = '42501';
  end if;

  select id into v_role_id from public.roles where code = p_role;
  if v_role_id is null then
    raise exception 'unknown role' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.profiles where id = p_target) then
    raise exception 'target user not found' using errcode = 'P0002';
  end if;
  if p_role = 'super_admin' and not public.user_has_role(p_actor, 'super_admin') then
    raise exception 'only a super_admin can grant super_admin' using errcode = '42501';
  end if;

  insert into public.user_roles (user_id, role_id, granted_by)
  values (p_target, v_role_id, p_actor)
  on conflict (user_id, role_id) do nothing;
  get diagnostics v_rows = row_count;

  if v_rows > 0 then
    perform public.write_audit_log(p_actor, 'rbac.role_granted', 'user', p_target::text, jsonb_build_object('role', p_role));
  end if;
end;
$$;

create or replace function public.admin_revoke_role(p_actor uuid, p_target uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role_id smallint;
  v_rows integer;
begin
  if p_actor is null or p_target is null or p_role is null then
    raise exception 'actor, target and role are required' using errcode = '22023';
  end if;
  if not public.user_has_permission(p_actor, 'roles.assign') then
    raise exception 'missing permission roles.assign' using errcode = '42501';
  end if;
  if p_actor = p_target then
    raise exception 'you cannot change your own roles' using errcode = '42501';
  end if;
  if p_role = 'customer' then
    raise exception 'the customer role cannot be revoked' using errcode = '23514';
  end if;

  select id into v_role_id from public.roles where code = p_role;
  if v_role_id is null then
    raise exception 'unknown role' using errcode = 'P0002';
  end if;
  if p_role = 'super_admin' and not public.user_has_role(p_actor, 'super_admin') then
    raise exception 'only a super_admin can revoke super_admin' using errcode = '42501';
  end if;

  delete from public.user_roles where user_id = p_target and role_id = v_role_id;
  get diagnostics v_rows = row_count;

  if v_rows > 0 then
    perform public.write_audit_log(p_actor, 'rbac.role_revoked', 'user', p_target::text, jsonb_build_object('role', p_role));
  end if;
end;
$$;

-- One-time bootstrap of the first super_admin. Refuses to run once any super_admin exists,
-- so it cannot be used later for privilege escalation. service_role only.
create or replace function public.bootstrap_super_admin(p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_role_id smallint;
begin
  perform pg_advisory_xact_lock(hashtext('onwa.bootstrap_super_admin'));

  select id into v_role_id from public.roles where code = 'super_admin';

  if exists (select 1 from public.user_roles where role_id = v_role_id) then
    raise exception 'a super_admin already exists' using errcode = '42501';
  end if;

  select id into v_user from public.profiles where lower(email) = lower(btrim(p_email));
  if v_user is null then
    raise exception 'no account with that email' using errcode = 'P0002';
  end if;

  insert into public.user_roles (user_id, role_id, granted_by) values (v_user, v_role_id, null);
  perform public.write_audit_log(null, 'rbac.bootstrap_super_admin', 'user', v_user::text, '{}'::jsonb);
end;
$$;
