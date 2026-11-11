-- ONWA SQL tests: RBAC + RLS + grants + audit immutability.
-- Run against a disposable database only (it creates users), inside one transaction that is rolled back:
--   Supabase local:  psql "$(supabase status -o env | grep DB_URL | cut -d= -f2 | tr -d '\"')" -v ON_ERROR_STOP=1 -f supabase/tests/001_rbac_rls.sql
--   Plain Postgres:  see supabase/tests/shim/local_auth_shim.sql
-- Any failed assertion raises an exception and aborts the run (non-zero exit with ON_ERROR_STOP=1).

begin;

-- Fixed identities
-- alice, bob: customers | carol: super_admin | dave: finance_manager | erin: customer_support | mallory: tries metadata escalation
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'alice@example.test', '{"full_name":"Alice Customer"}'),
  ('00000000-0000-0000-0000-00000000000b', 'bob@example.test', '{"full_name":"Bob Customer"}'),
  ('00000000-0000-0000-0000-00000000000c', 'carol@example.test', '{"full_name":"Carol Admin"}'),
  ('00000000-0000-0000-0000-00000000000d', 'dave@example.test', '{"full_name":"Dave Finance"}'),
  ('00000000-0000-0000-0000-00000000000e', 'erin@example.test', '{"full_name":"Erin Support"}'),
  ('00000000-0000-0000-0000-00000000000f', 'mallory@example.test',
     '{"full_name":"Mallory","role":"super_admin","roles":["super_admin"],"is_admin":true}');

insert into public.user_roles (user_id, role_id, granted_by)
select '00000000-0000-0000-0000-00000000000c', id, null from public.roles where code = 'super_admin';
insert into public.user_roles (user_id, role_id, granted_by)
select '00000000-0000-0000-0000-00000000000d', id, null from public.roles where code = 'finance_manager';
insert into public.user_roles (user_id, role_id, granted_by)
select '00000000-0000-0000-0000-00000000000e', id, null from public.roles where code = 'customer_support';

-- 1. Structure ------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  ) then
    raise exception 'FAIL: a table in public has RLS disabled';
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'anon'
  ) then
    raise exception 'FAIL: anon has table grants in public';
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'authenticated'
      and privilege_type in ('INSERT', 'DELETE', 'TRUNCATE')
  ) then
    raise exception 'FAIL: authenticated has INSERT/DELETE/TRUNCATE somewhere in public';
  end if;

  if (select count(*) from public.role_permissions rp join public.roles r on r.id = rp.role_id where r.code = 'super_admin')
     <> (select count(*) from public.permissions) then
    raise exception 'FAIL: super_admin does not hold every permission';
  end if;
end $$;

-- 2. Sign-up creates exactly one profile and only the customer role --------
do $$
declare v_roles text[];
begin
  if (select count(*) from public.profiles where id = '00000000-0000-0000-0000-00000000000a') <> 1 then
    raise exception 'FAIL: profile not created by trigger';
  end if;
  if (select full_name from public.profiles where id = '00000000-0000-0000-0000-00000000000a') <> 'Alice Customer' then
    raise exception 'FAIL: full_name not copied';
  end if;

  select array_agg(r.code) into v_roles
  from public.user_roles ur join public.roles r on r.id = ur.role_id
  where ur.user_id = '00000000-0000-0000-0000-00000000000f';
  if v_roles is distinct from array['customer'] then
    raise exception 'FAIL: metadata role escalation produced roles %', v_roles;
  end if;
end $$;

-- 3. anon is denied everything --------------------------------------------
do $$
begin
  set local role anon;
  begin
    perform 1 from public.profiles limit 1;
    raise exception 'FAIL: anon could read profiles';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.audit_logs limit 1;
    raise exception 'FAIL: anon could read audit_logs';
  exception when insufficient_privilege then null;
  end;
  reset role;
end $$;

-- 4. Customer (alice) isolation and column-level protection -----------------
do $$
declare v_n integer;
begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
  set local role authenticated;

  select count(*) into v_n from public.profiles;
  if v_n <> 1 then raise exception 'FAIL: alice sees % profiles (expected 1)', v_n; end if;

  select count(*) into v_n from public.profiles where id = '00000000-0000-0000-0000-00000000000b';
  if v_n <> 0 then raise exception 'FAIL: alice can read bob''s profile'; end if;

  update public.profiles set full_name = 'Alice Updated', phone = '+2348031234567'
  where id = '00000000-0000-0000-0000-00000000000a';
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'FAIL: alice cannot update own profile'; end if;

  update public.profiles set full_name = 'Hacked' where id = '00000000-0000-0000-0000-00000000000b';
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'FAIL: alice updated bob''s profile'; end if;

  begin
    update public.profiles set status = 'suspended' where id = '00000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: alice changed her own status';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set email = 'x@example.test' where id = '00000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: alice changed her own email column';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.profiles (id, email) values (gen_random_uuid(), 'new@example.test');
    raise exception 'FAIL: alice inserted a profile';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.profiles where id = '00000000-0000-0000-0000-00000000000a';
    raise exception 'FAIL: alice deleted a profile';
  exception when insufficient_privilege then null;
  end;

  -- role assignments: can read own only, can never write
  select count(*) into v_n from public.user_roles;
  if v_n <> 1 then raise exception 'FAIL: alice sees % user_roles rows (expected 1)', v_n; end if;
  begin
    insert into public.user_roles (user_id, role_id)
    select '00000000-0000-0000-0000-00000000000a', id from public.roles where code = 'super_admin';
    raise exception 'FAIL: alice granted herself super_admin';
  exception when insufficient_privilege then null;
  end;

  -- reference tables and audit logs are staff-only
  select count(*) into v_n from public.roles;
  if v_n <> 0 then raise exception 'FAIL: alice can read roles'; end if;
  select count(*) into v_n from public.permissions;
  if v_n <> 0 then raise exception 'FAIL: alice can read permissions'; end if;
  select count(*) into v_n from public.audit_logs;
  if v_n <> 0 then raise exception 'FAIL: alice can read audit_logs'; end if;
  begin
    insert into public.audit_logs (action, entity_type) values ('x', 'y');
    raise exception 'FAIL: alice wrote an audit log';
  exception when insufficient_privilege then null;
  end;

  -- privileged functions are not callable by clients
  begin
    perform public.admin_assign_role('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'super_admin');
    raise exception 'FAIL: alice executed admin_assign_role';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.get_user_access('00000000-0000-0000-0000-00000000000c');
    raise exception 'FAIL: alice executed get_user_access';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.bootstrap_super_admin('alice@example.test');
    raise exception 'FAIL: alice executed bootstrap_super_admin';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.user_has_permission('00000000-0000-0000-0000-00000000000c', 'roles.assign');
    raise exception 'FAIL: alice probed another user''s permissions';
  exception when insufficient_privilege then null;
  end;

  reset role;
end $$;

-- 5. Staff visibility follows permissions, not job titles --------------------
do $$
declare v_n integer;
begin
  -- customer_support holds customers.read: sees all profiles, but not audit logs or roles
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000e","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into v_n from public.profiles;
  if v_n < 6 then raise exception 'FAIL: support cannot read all profiles (% rows)', v_n; end if;
  select count(*) into v_n from public.audit_logs;
  if v_n <> 0 then raise exception 'FAIL: support can read audit logs'; end if;
  select count(*) into v_n from public.roles;
  if v_n <> 0 then raise exception 'FAIL: support can read roles'; end if;
  begin
    update public.profiles set full_name = 'Support edit' where id = '00000000-0000-0000-0000-00000000000b';
    get diagnostics v_n = row_count;
    if v_n <> 0 then raise exception 'FAIL: support updated another profile directly'; end if;
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- finance_manager has no customers.read: sees only itself
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into v_n from public.profiles;
  if v_n <> 1 then raise exception 'FAIL: finance sees % profiles (expected 1)', v_n; end if;
  reset role;

  -- super_admin sees roles, permissions and audit logs
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into v_n from public.roles;
  if v_n <> 10 then raise exception 'FAIL: super_admin sees % roles (expected 10)', v_n; end if;
  select count(*) into v_n from public.permissions;
  if v_n < 1 then raise exception 'FAIL: super_admin cannot read permissions'; end if;
  reset role;
end $$;

-- 6. Suspended accounts lose their privileges --------------------------------
do $$
begin
  update public.profiles set status = 'suspended' where id = '00000000-0000-0000-0000-00000000000e';
  if public.user_has_permission('00000000-0000-0000-0000-00000000000e', 'customers.read') then
    raise exception 'FAIL: suspended staff keeps permissions';
  end if;
  update public.profiles set status = 'active' where id = '00000000-0000-0000-0000-00000000000e';
end $$;

-- 7. Audited role administration (service_role path) -------------------------
do $$
declare v_before bigint; v_after bigint;
begin
  set local role service_role;

  select count(*) into v_before from public.audit_logs;
  perform public.admin_assign_role('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a', 'seller');
  select count(*) into v_after from public.audit_logs;
  if v_after <> v_before + 1 then raise exception 'FAIL: grant was not audited'; end if;

  -- idempotent: granting again does not write a second audit row
  perform public.admin_assign_role('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a', 'seller');
  select count(*) into v_before from public.audit_logs;
  if v_before <> v_after then raise exception 'FAIL: duplicate grant wrote audit row'; end if;

  -- cannot change own roles
  begin
    perform public.admin_assign_role('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000c', 'finance_manager');
    raise exception 'FAIL: self assignment allowed';
  exception when insufficient_privilege then null;
  end;

  -- actors without roles.assign are refused (finance, support)
  begin
    perform public.admin_assign_role('00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-00000000000a', 'super_admin');
    raise exception 'FAIL: finance_manager assigned super_admin';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.admin_assign_role('00000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-00000000000a', 'seller_manager');
    raise exception 'FAIL: customer_support assigned a role';
  exception when insufficient_privilege then null;
  end;

  -- unknown role / unknown target
  begin
    perform public.admin_assign_role('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a', 'root');
    raise exception 'FAIL: unknown role accepted';
  exception when no_data_found then null;
  end;
  begin
    perform public.admin_assign_role('00000000-0000-0000-0000-00000000000c', gen_random_uuid(), 'seller');
    raise exception 'FAIL: unknown target accepted';
  exception when no_data_found then null;
  end;

  -- revoke works, is audited, and the customer base role is protected
  perform public.admin_revoke_role('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a', 'seller');
  if exists (
    select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
    where ur.user_id = '00000000-0000-0000-0000-00000000000a' and r.code = 'seller'
  ) then raise exception 'FAIL: seller role still present after revoke'; end if;
  begin
    perform public.admin_revoke_role('00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000a', 'customer');
    raise exception 'FAIL: customer role revoked';
  exception when check_violation then null;
  end;

  if (select count(*) from public.audit_logs where action in ('rbac.role_granted', 'rbac.role_revoked')) <> 2 then
    raise exception 'FAIL: expected exactly one grant and one revoke audit row';
  end if;

  -- last super_admin cannot be removed (direct delete as service_role)
  begin
    delete from public.user_roles
    where user_id = '00000000-0000-0000-0000-00000000000c'
      and role_id = (select id from public.roles where code = 'super_admin');
    raise exception 'FAIL: last super_admin removed';
  exception when check_violation then null;
  end;

  -- bootstrap is refused once a super_admin exists
  begin
    perform public.bootstrap_super_admin('alice@example.test');
    raise exception 'FAIL: bootstrap ran while a super_admin exists';
  exception when insufficient_privilege then null;
  end;

  reset role;
end $$;

-- 8. Audit log is append-only, even for service_role --------------------------
do $$
begin
  set local role service_role;
  begin
    update public.audit_logs set action = 'tampered';
    raise exception 'FAIL: audit_logs updated';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.audit_logs;
    raise exception 'FAIL: audit_logs deleted';
  exception when insufficient_privilege then null;
  end;
  begin
    truncate public.audit_logs;
    raise exception 'FAIL: audit_logs truncated';
  exception when insufficient_privilege then null;
  end;
  reset role;
end $$;

-- 8b. The trigger itself blocks changes even for the table owner (not just missing grants)
do $$
begin
  begin
    update public.audit_logs set action = 'tampered';
    raise exception 'FAIL: owner updated audit_logs';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.audit_logs;
    raise exception 'FAIL: owner deleted audit_logs';
  exception when insufficient_privilege then null;
  end;
  begin
    truncate public.audit_logs;
    raise exception 'FAIL: owner truncated audit_logs';
  exception when insufficient_privilege then null;
  end;
end $$;

-- 9. get_user_access returns what the API relies on ---------------------------
do $$
declare v jsonb;
begin
  set local role service_role;
  v := public.get_user_access('00000000-0000-0000-0000-00000000000d');
  if not (v -> 'roles') ? 'finance_manager' then raise exception 'FAIL: finance role missing from access'; end if;
  if not (v -> 'permissions') ? 'withdrawals.review' then raise exception 'FAIL: finance permission missing'; end if;
  if (v -> 'permissions') ? 'roles.assign' then raise exception 'FAIL: finance holds roles.assign'; end if;
  reset role;
end $$;

rollback;

\echo 'ALL ONWA SQL TESTS PASSED (transaction rolled back)'
