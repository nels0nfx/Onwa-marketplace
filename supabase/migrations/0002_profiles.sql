-- ONWA 0002: user profiles (one row per auth.users row).

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '' check (char_length(full_name) <= 100),
  phone text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 500),
  status text not null default 'active' check (status in ('active', 'suspended', 'deactivated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_email_lower_idx on public.profiles (lower(email));
create index profiles_created_at_idx on public.profiles (created_at desc);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

comment on table public.profiles is 'Application profile for each authenticated user. Created by trigger, never by clients.';
