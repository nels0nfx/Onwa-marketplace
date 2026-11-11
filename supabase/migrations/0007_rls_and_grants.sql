-- ONWA 0007: row level security, table grants and function grants.
-- Model: deny by default. A role can do only what is granted below AND allowed by a policy.
-- service_role (server-side API only) bypasses RLS by design; its key must never reach a browser.

alter table public.profiles enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles enable row level security;
alter table public.audit_logs enable row level security;

-- Start from nothing for the API roles.
revoke all on public.profiles, public.roles, public.permissions, public.role_permissions,
  public.user_roles, public.audit_logs from anon, authenticated;

-- ---------------------------------------------------------------- profiles
grant select on public.profiles to authenticated;
-- Column-level update: clients can never change email, status, id or timestamps.
grant update (full_name, phone, avatar_url) on public.profiles to authenticated;

create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy profiles_select_staff on public.profiles
  for select to authenticated
  using ((select public.has_permission('customers.read')));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) and status = 'active')
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------- roles, permissions, assignments
grant select on public.roles, public.permissions, public.role_permissions, public.user_roles to authenticated;

create policy roles_select_staff on public.roles
  for select to authenticated
  using ((select public.has_permission('roles.read')));

create policy permissions_select_staff on public.permissions
  for select to authenticated
  using ((select public.has_permission('roles.read')));

create policy role_permissions_select_staff on public.role_permissions
  for select to authenticated
  using ((select public.has_permission('roles.read')));

create policy user_roles_select_own on public.user_roles
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy user_roles_select_staff on public.user_roles
  for select to authenticated
  using ((select public.has_permission('roles.read')));

-- No insert/update/delete policies or grants exist for authenticated: role changes
-- go only through public.admin_assign_role / admin_revoke_role via the API (service_role).

-- ---------------------------------------------------------------- audit logs
grant select on public.audit_logs to authenticated;

create policy audit_logs_select_staff on public.audit_logs
  for select to authenticated
  using ((select public.has_permission('audit.read')));

-- ---------------------------------------------------------------- service_role
grant select, insert, update, delete on public.profiles, public.roles, public.permissions,
  public.role_permissions, public.user_roles to service_role;
grant select, insert on public.audit_logs to service_role;
revoke update, delete, truncate on public.audit_logs from service_role;

-- ---------------------------------------------------------------- function privileges
revoke all on function public.user_has_permission(uuid, text) from public, anon, authenticated;
revoke all on function public.user_has_role(uuid, text) from public, anon, authenticated;
revoke all on function public.has_permission(text) from public, anon;
revoke all on function public.has_role(text) from public, anon;
revoke all on function public.get_user_access(uuid) from public, anon, authenticated;
revoke all on function public.admin_assign_role(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.admin_revoke_role(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.bootstrap_super_admin(text) from public, anon, authenticated;
revoke all on function public.write_audit_log(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.block_audit_log_changes() from public, anon, authenticated;
revoke all on function public.guard_last_super_admin() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.handle_user_email_change() from public, anon, authenticated;

-- Used inside RLS policies, so authenticated needs EXECUTE. They only answer for auth.uid().
grant execute on function public.has_permission(text) to authenticated, service_role;
grant execute on function public.has_role(text) to authenticated, service_role;

grant execute on function public.user_has_permission(uuid, text) to service_role;
grant execute on function public.user_has_role(uuid, text) to service_role;
grant execute on function public.get_user_access(uuid) to service_role;
grant execute on function public.admin_assign_role(uuid, uuid, text) to service_role;
grant execute on function public.admin_revoke_role(uuid, uuid, text) to service_role;
grant execute on function public.bootstrap_super_admin(text) to service_role;
grant execute on function public.write_audit_log(uuid, text, text, text, jsonb) to service_role;
