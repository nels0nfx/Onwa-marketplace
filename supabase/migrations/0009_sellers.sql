-- ONWA 0009: seller applications, review workflow, sellers and storefronts.
-- Application states: draft, submitted, under_review, more_info_required, approved, rejected.
-- Seller account states: active, suspended. Approving a seller does NOT approve any listing.

create table public.seller_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'under_review', 'more_info_required', 'approved', 'rejected')),
  legal_name text check (legal_name is null or char_length(legal_name) <= 120),
  business_name text check (business_name is null or char_length(business_name) <= 80),
  contact_email text check (contact_email is null or char_length(contact_email) <= 254),
  contact_phone text check (contact_phone is null or contact_phone ~ '^\+[1-9][0-9]{7,14}$'),
  address_line1 text check (address_line1 is null or char_length(address_line1) <= 150),
  address_city text check (address_city is null or char_length(address_city) <= 80),
  address_lga text check (address_lga is null or char_length(address_lga) <= 80),
  address_state text check (address_state is null or public.is_ng_state(address_state)),
  categories text[] not null default '{}' check (cardinality(categories) <= 6),
  description text check (description is null or char_length(description) <= 1000),
  id_type text check (id_type is null or id_type in ('nin', 'drivers_licence', 'voters_card', 'intl_passport')),
  bank_name text check (bank_name is null or char_length(bank_name) <= 60),
  bank_account_number text check (bank_account_number is null or bank_account_number ~ '^[0-9]{10}$'),
  bank_account_name text check (bank_account_name is null or char_length(bank_account_name) <= 100),
  reviewer_note text check (reviewer_note is null or char_length(reviewer_note) <= 1000),
  submitted_at timestamptz,
  decided_at timestamptz,
  decided_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One live application per user. A rejected application does not block re-applying.
create unique index seller_applications_one_live_per_user_idx
  on public.seller_applications (user_id) where status <> 'rejected';
create index seller_applications_status_idx on public.seller_applications (status, updated_at desc);

create trigger seller_applications_set_updated_at
  before update on public.seller_applications
  for each row execute function public.set_updated_at();

create table public.seller_application_documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.seller_applications (id) on delete cascade,
  kind text not null check (kind in ('identity', 'business_registration', 'proof_of_address', 'other')),
  storage_path text not null unique,
  original_name text not null check (char_length(original_name) between 1 and 200),
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  size_bytes integer not null check (size_bytes between 1 and 5242880),
  created_at timestamptz not null default now()
);
create index seller_application_documents_app_idx on public.seller_application_documents (application_id);

create table public.seller_application_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.seller_applications (id) on delete cascade,
  from_status text,
  to_status text not null,
  actor_id uuid,
  note text check (note is null or char_length(note) <= 1000),
  created_at timestamptz not null default now()
);
create index seller_application_events_app_idx on public.seller_application_events (application_id, created_at);

create table public.sellers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete restrict,
  application_id uuid not null unique references public.seller_applications (id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'suspended')),
  status_note text check (status_note is null or char_length(status_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger sellers_set_updated_at before update on public.sellers
  for each row execute function public.set_updated_at();

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null unique references public.sellers (id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 60),
  name text not null check (char_length(name) between 2 and 80),
  tagline text check (tagline is null or char_length(tagline) <= 120),
  description text check (description is null or char_length(description) <= 1000),
  policies text check (policies is null or char_length(policies) <= 2000),
  delivery_info text check (delivery_info is null or char_length(delivery_info) <= 1000),
  accent text not null default 'gold' check (accent in ('gold', 'obsidian', 'forest', 'burgundy', 'navy')),
  logo_path text check (logo_path is null or char_length(logo_path) <= 300),
  cover_path text check (cover_path is null or char_length(cover_path) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger stores_set_updated_at before update on public.stores
  for each row execute function public.set_updated_at();

create table public.store_follows (
  user_id uuid not null references public.profiles (id) on delete cascade,
  store_id uuid not null references public.stores (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, store_id)
);
create index store_follows_store_idx on public.store_follows (store_id);

-- Documents may only be added while the application is editable.
create or replace function public.guard_document_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.seller_applications a
    where a.id = new.application_id and a.status in ('draft', 'more_info_required')
  ) then
    raise exception 'application is not editable' using errcode = '23514';
  end if;
  if (select count(*) from public.seller_application_documents where application_id = new.application_id) >= 8 then
    raise exception 'document limit reached (8)' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger seller_application_documents_guard
  before insert on public.seller_application_documents
  for each row execute function public.guard_document_insert();

-- ------------------------------------------------------------------ functions

-- Names of required things still missing from an application (empty array = ready to submit).
create or replace function public.seller_application_missing(p_app uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.seller_applications%rowtype;
  m text[] := '{}';
begin
  select * into a from public.seller_applications where id = p_app;
  if not found then return array['application']; end if;
  if coalesce(btrim(a.legal_name), '') = '' then m := array_append(m, 'legal name'::text); end if;
  if coalesce(btrim(a.business_name), '') = '' then m := array_append(m, 'business name'::text); end if;
  if coalesce(btrim(a.contact_email), '') = '' then m := array_append(m, 'contact email'::text); end if;
  if a.contact_phone is null then m := array_append(m, 'contact phone'::text); end if;
  if coalesce(btrim(a.address_line1), '') = '' then m := array_append(m, 'business address'::text); end if;
  if coalesce(btrim(a.address_city), '') = '' then m := array_append(m, 'city'::text); end if;
  if coalesce(btrim(a.address_lga), '') = '' then m := array_append(m, 'LGA'::text); end if;
  if a.address_state is null then m := array_append(m, 'state'::text); end if;
  if cardinality(a.categories) = 0 then m := array_append(m, 'selling category'::text); end if;
  if char_length(coalesce(a.description, '')) < 30 then m := array_append(m, 'business description (30+ characters)'::text); end if;
  if a.id_type is null then m := array_append(m, 'identity document type'::text); end if;
  if coalesce(btrim(a.bank_name), '') = '' then m := array_append(m, 'bank name'::text); end if;
  if a.bank_account_number is null then m := array_append(m, 'bank account number'::text); end if;
  if coalesce(btrim(a.bank_account_name), '') = '' then m := array_append(m, 'bank account name'::text); end if;
  if not exists (select 1 from public.seller_application_documents d where d.application_id = a.id and d.kind = 'identity') then
    m := array_append(m, 'identity document upload'::text);
  end if;
  return m;
end;
$$;

-- Create or update the caller's draft. Omitted fields are cleared. Returns the application id.
create or replace function public.save_seller_application(p_user uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_status text;
begin
  perform pg_advisory_xact_lock(hashtext('seller_app:' || p_user::text));

  select id, status into v_id, v_status
  from public.seller_applications
  where user_id = p_user and status <> 'rejected'
  for update;

  if v_id is null then
    insert into public.seller_applications (user_id) values (p_user) returning id into v_id;
    insert into public.seller_application_events (application_id, from_status, to_status, actor_id)
    values (v_id, null, 'draft', p_user);
  elsif v_status not in ('draft', 'more_info_required') then
    raise exception 'application cannot be edited while %', replace(v_status, '_', ' ') using errcode = '23514';
  end if;

  update public.seller_applications set
    legal_name = nullif(btrim(p ->> 'legalName'), ''),
    business_name = nullif(btrim(p ->> 'businessName'), ''),
    contact_email = nullif(btrim(p ->> 'contactEmail'), ''),
    contact_phone = nullif(p ->> 'contactPhone', ''),
    address_line1 = nullif(btrim(p ->> 'addressLine1'), ''),
    address_city = nullif(btrim(p ->> 'addressCity'), ''),
    address_lga = nullif(btrim(p ->> 'addressLga'), ''),
    address_state = nullif(p ->> 'addressState', ''),
    categories = coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'categories', '[]'::jsonb))), '{}'),
    description = nullif(btrim(p ->> 'description'), ''),
    id_type = nullif(p ->> 'idType', ''),
    bank_name = nullif(btrim(p ->> 'bankName'), ''),
    bank_account_number = nullif(p ->> 'bankAccountNumber', ''),
    bank_account_name = nullif(btrim(p ->> 'bankAccountName'), '')
  where id = v_id;

  return v_id;
end;
$$;

create or replace function public.submit_seller_application(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_status text;
  v_missing text[];
begin
  select id, status into v_id, v_status
  from public.seller_applications where user_id = p_user and status <> 'rejected' for update;
  if v_id is null then
    raise exception 'no application to submit' using errcode = 'P0002';
  end if;
  if v_status not in ('draft', 'more_info_required') then
    raise exception 'application is already %', replace(v_status, '_', ' ') using errcode = '23514';
  end if;
  v_missing := public.seller_application_missing(v_id);
  if cardinality(v_missing) > 0 then
    raise exception 'application is incomplete: %', array_to_string(v_missing, ', ') using errcode = '22023';
  end if;

  update public.seller_applications
  set status = 'submitted', submitted_at = now(), reviewer_note = null
  where id = v_id;
  insert into public.seller_application_events (application_id, from_status, to_status, actor_id)
  values (v_id, v_status, 'submitted', p_user);
  perform public.write_audit_log(p_user, 'seller_application.submitted', 'seller_application', v_id::text, '{}'::jsonb);
end;
$$;

create or replace function public.generate_store_slug(p_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base text;
  v_candidate text;
  v_n integer := 1;
  v_reserved text[] := array['admin', 'api', 'new', 'sell', 'seller', 'account', 'login', 'register', 'stores', 'store', 'status', 'help', 'auth'];
begin
  v_base := btrim(regexp_replace(lower(btrim(coalesce(p_name, ''))), '[^a-z0-9]+', '-', 'g'), '-');
  v_base := btrim(left(v_base, 50), '-');
  if v_base = '' then v_base := 'store'; end if;
  if char_length(v_base) < 3 then v_base := v_base || '-store'; end if;
  v_candidate := v_base;
  while v_candidate = any (v_reserved) or exists (select 1 from public.stores where slug = v_candidate) loop
    v_n := v_n + 1;
    v_candidate := v_base || '-' || v_n::text;
  end loop;
  return v_candidate;
end;
$$;

-- Reviewer decisions. Approval creates the seller, the storefront and the seller role atomically.
create or replace function public.review_seller_application(p_actor uuid, p_application uuid, p_action text, p_note text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.seller_applications%rowtype;
  v_to text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_missing text[];
  v_seller uuid;
begin
  if p_actor is null or p_application is null or p_action is null then
    raise exception 'actor, application and action are required' using errcode = '22023';
  end if;
  if not public.user_has_permission(p_actor, 'sellers.review') then
    raise exception 'missing permission sellers.review' using errcode = '42501';
  end if;

  select * into a from public.seller_applications where id = p_application for update;
  if not found then
    raise exception 'application not found' using errcode = 'P0002';
  end if;
  if a.user_id = p_actor then
    raise exception 'you cannot review your own application' using errcode = '42501';
  end if;

  if p_action = 'start_review' and a.status = 'submitted' then v_to := 'under_review';
  elsif p_action = 'request_info' and a.status = 'under_review' then v_to := 'more_info_required';
  elsif p_action = 'approve' and a.status = 'under_review' then v_to := 'approved';
  elsif p_action = 'reject' and a.status in ('submitted', 'under_review') then v_to := 'rejected';
  else
    raise exception 'cannot % an application that is %', replace(p_action, '_', ' '), replace(a.status, '_', ' ') using errcode = '23514';
  end if;

  if p_action in ('request_info', 'reject') and (v_note is null or char_length(v_note) < 5) then
    raise exception 'a note of at least 5 characters is required' using errcode = '22023';
  end if;

  if p_action = 'approve' then
    v_missing := public.seller_application_missing(a.id);
    if cardinality(v_missing) > 0 then
      raise exception 'application is incomplete: %', array_to_string(v_missing, ', ') using errcode = '22023';
    end if;

    insert into public.sellers (user_id, application_id) values (a.user_id, a.id) returning id into v_seller;
    insert into public.stores (seller_id, slug, name, description)
    values (v_seller, public.generate_store_slug(a.business_name), a.business_name, left(a.description, 1000));
    insert into public.user_roles (user_id, role_id, granted_by)
    select a.user_id, r.id, p_actor from public.roles r where r.code = 'seller'
    on conflict (user_id, role_id) do nothing;
  end if;

  update public.seller_applications
  set status = v_to,
      reviewer_note = v_note,
      decided_at = case when v_to in ('approved', 'rejected') then now() else decided_at end,
      decided_by = case when v_to in ('approved', 'rejected') then p_actor else decided_by end
  where id = a.id;

  insert into public.seller_application_events (application_id, from_status, to_status, actor_id, note)
  values (a.id, a.status, v_to, p_actor, v_note);
  perform public.write_audit_log(p_actor, 'seller_application.' || p_action, 'seller_application', a.id::text,
    jsonb_build_object('from', a.status, 'to', v_to));

  return v_to;
end;
$$;

create or replace function public.set_seller_status(p_actor uuid, p_seller uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.user_has_permission(p_actor, 'sellers.manage') then
    raise exception 'missing permission sellers.manage' using errcode = '42501';
  end if;
  if p_status not in ('active', 'suspended') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  if p_status = 'suspended' and (v_note is null or char_length(v_note) < 5) then
    raise exception 'a note of at least 5 characters is required to suspend' using errcode = '22023';
  end if;
  select status into v_old from public.sellers where id = p_seller for update;
  if v_old is null then
    raise exception 'seller not found' using errcode = 'P0002';
  end if;
  update public.sellers set status = p_status, status_note = v_note where id = p_seller;
  perform public.write_audit_log(p_actor, 'seller.status_changed', 'seller', p_seller::text,
    jsonb_build_object('from', v_old, 'to', p_status));
end;
$$;

-- ------------------------------------------------------------------ RLS and grants
alter table public.seller_applications enable row level security;
alter table public.seller_application_documents enable row level security;
alter table public.seller_application_events enable row level security;
alter table public.sellers enable row level security;
alter table public.stores enable row level security;
alter table public.store_follows enable row level security;

revoke all on public.seller_applications, public.seller_application_documents, public.seller_application_events,
  public.sellers, public.stores, public.store_follows from anon, authenticated;

grant select on public.seller_applications, public.seller_application_documents, public.seller_application_events,
  public.sellers, public.stores, public.store_follows to authenticated;
grant select, insert, update, delete on public.seller_applications, public.seller_application_documents,
  public.seller_application_events, public.sellers, public.stores, public.store_follows to service_role;

-- Applicants see only their own application, its documents and history. Staff with sellers.read see all.
create policy seller_applications_select_own on public.seller_applications
  for select to authenticated using (user_id = (select auth.uid()));
create policy seller_applications_select_staff on public.seller_applications
  for select to authenticated using ((select public.has_permission('sellers.read')));

create policy seller_documents_select_own on public.seller_application_documents
  for select to authenticated using (exists (
    select 1 from public.seller_applications a where a.id = application_id and a.user_id = (select auth.uid())));
create policy seller_documents_select_staff on public.seller_application_documents
  for select to authenticated using ((select public.has_permission('sellers.read')));

create policy seller_events_select_own on public.seller_application_events
  for select to authenticated using (exists (
    select 1 from public.seller_applications a where a.id = application_id and a.user_id = (select auth.uid())));
create policy seller_events_select_staff on public.seller_application_events
  for select to authenticated using ((select public.has_permission('sellers.read')));

create policy sellers_select_own on public.sellers
  for select to authenticated using (user_id = (select auth.uid()));
create policy sellers_select_staff on public.sellers
  for select to authenticated using ((select public.has_permission('sellers.read')));

create policy stores_select_own on public.stores
  for select to authenticated using (exists (
    select 1 from public.sellers s where s.id = seller_id and s.user_id = (select auth.uid())));
create policy stores_select_staff on public.stores
  for select to authenticated using ((select public.has_permission('sellers.read')));

create policy store_follows_select_own on public.store_follows
  for select to authenticated using (user_id = (select auth.uid()));
-- Public storefront reads and every write go through the API (service_role); anon has no table access.

-- ------------------------------------------------------------------ function privileges
revoke all on function public.guard_document_insert() from public, anon, authenticated;
revoke all on function public.seller_application_missing(uuid) from public, anon, authenticated;
revoke all on function public.save_seller_application(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.submit_seller_application(uuid) from public, anon, authenticated;
revoke all on function public.generate_store_slug(text) from public, anon, authenticated;
revoke all on function public.review_seller_application(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.set_seller_status(uuid, uuid, text, text) from public, anon, authenticated;

grant execute on function public.seller_application_missing(uuid) to service_role;
grant execute on function public.save_seller_application(uuid, jsonb) to service_role;
grant execute on function public.submit_seller_application(uuid) to service_role;
grant execute on function public.generate_store_slug(text) to service_role;
grant execute on function public.review_seller_application(uuid, uuid, text, text) to service_role;
grant execute on function public.set_seller_status(uuid, uuid, text, text) to service_role;
