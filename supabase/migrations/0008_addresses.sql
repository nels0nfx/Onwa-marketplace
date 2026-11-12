-- ONWA 0008: Nigerian states helper and customer delivery addresses.

create or replace function public.is_ng_state(p_state text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_state = any (array[
    'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta',
    'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'FCT', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi',
    'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers',
    'Sokoto', 'Taraba', 'Yobe', 'Zamfara'
  ]);
$$;

create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  label text not null default 'Home' check (char_length(label) between 1 and 40),
  recipient_name text not null check (char_length(recipient_name) between 2 and 100),
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  line1 text not null check (char_length(line1) between 3 and 150),
  line2 text check (line2 is null or char_length(line2) <= 150),
  city text not null check (char_length(city) between 2 and 80),
  lga text not null check (char_length(lga) between 2 and 80),
  state text not null check (public.is_ng_state(state)),
  landmark text check (landmark is null or char_length(landmark) <= 150),
  postal_code text check (postal_code is null or postal_code ~ '^[0-9]{6}$'),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index addresses_user_id_idx on public.addresses (user_id);
create unique index addresses_one_default_per_user_idx on public.addresses (user_id) where is_default;

create trigger addresses_set_updated_at
  before update on public.addresses
  for each row execute function public.set_updated_at();

-- Max 10 addresses per user; first address is the default; a new default demotes the old one.
create or replace function public.addresses_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.addresses where user_id = new.user_id) >= 10 then
      raise exception 'address limit reached (10)' using errcode = '23514';
    end if;
    if not exists (select 1 from public.addresses where user_id = new.user_id) then
      new.is_default := true;
    end if;
  end if;
  if new.is_default then
    update public.addresses set is_default = false
    where user_id = new.user_id and id <> new.id and is_default;
  end if;
  return new;
end;
$$;

create trigger addresses_before_write
  before insert or update on public.addresses
  for each row execute function public.addresses_before_write();

-- When the default address is deleted, promote the most recent remaining one.
create or replace function public.addresses_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.is_default then
    update public.addresses set is_default = true
    where id = (select id from public.addresses where user_id = old.user_id order by created_at desc limit 1);
  end if;
  return old;
end;
$$;

create trigger addresses_after_delete
  after delete on public.addresses
  for each row execute function public.addresses_after_delete();

alter table public.addresses enable row level security;
revoke all on public.addresses from anon, authenticated;
grant select, insert, delete on public.addresses to authenticated;
grant update (label, recipient_name, phone, line1, line2, city, lga, state, landmark, postal_code, is_default)
  on public.addresses to authenticated;
grant select, insert, update, delete on public.addresses to service_role;

create policy addresses_select_own on public.addresses
  for select to authenticated using (user_id = (select auth.uid()));
create policy addresses_insert_own on public.addresses
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy addresses_update_own on public.addresses
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy addresses_delete_own on public.addresses
  for delete to authenticated using (user_id = (select auth.uid()));

revoke all on function public.addresses_before_write() from public, anon, authenticated;
revoke all on function public.addresses_after_delete() from public, anon, authenticated;
