-- ONWA 0011: catalogue for physical products.
-- Categories, products, variants (price in integer kobo), images, immutable inventory movements,
-- listing review workflow, and transactional stock functions that can never oversell.
-- Product states: draft, pending_review, changes_requested, approved (live), rejected, archived.

create or replace function public.slugify(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(lower(btrim(coalesce(p, ''))), '[^a-z0-9]+', '-', 'g'), '-');
$$;

-- ------------------------------------------------------------------ categories
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.categories (id) on delete restrict,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 2 and 80),
  name text not null check (char_length(name) between 2 and 60),
  fulfilment text not null default 'physical' check (fulfilment in ('physical', 'digital', 'service')),
  sort_order integer not null default 100 check (sort_order between 0 and 9999),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index categories_parent_idx on public.categories (parent_id);
create trigger categories_set_updated_at before update on public.categories
  for each row execute function public.set_updated_at();

-- At most two levels; children inherit the parent's fulfilment type.
create or replace function public.categories_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_parent public.categories%rowtype;
begin
  if new.parent_id is not null then
    if new.parent_id = new.id then
      raise exception 'a category cannot be its own parent' using errcode = '23514';
    end if;
    select * into v_parent from public.categories where id = new.parent_id;
    if v_parent.parent_id is not null then
      raise exception 'categories have at most two levels' using errcode = '23514';
    end if;
    new.fulfilment := v_parent.fulfilment;
  end if;
  return new;
end;
$$;
create trigger categories_before_write before insert or update on public.categories
  for each row execute function public.categories_before_write();

-- Starter top-level categories for physical goods (reference data; staff can add, rename or hide them).
insert into public.categories (slug, name, sort_order) values
  ('fashion-clothing', 'Fashion and clothing', 10),
  ('beauty-personal-care', 'Beauty and personal care', 20),
  ('phones-tablets', 'Phones and tablets', 30),
  ('electronics-gadgets', 'Electronics and gadgets', 40),
  ('home-living', 'Home and living', 50),
  ('kitchen-dining', 'Kitchen and dining', 60),
  ('food-groceries', 'Food and groceries', 70),
  ('health-wellness', 'Health and wellness', 80),
  ('baby-kids', 'Baby and kids', 90),
  ('books-stationery', 'Books and stationery', 100),
  ('art-crafts', 'Art and crafts', 110),
  ('sports-outdoors', 'Sports and outdoors', 120),
  ('automotive', 'Automotive', 130),
  ('pets', 'Pets', 140);

-- ------------------------------------------------------------------ products
create table public.products (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.sellers (id) on delete restrict,
  category_id uuid references public.categories (id) on delete restrict,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 90),
  name text not null check (char_length(name) between 3 and 120),
  description text check (description is null or char_length(description) <= 5000),
  brand text check (brand is null or char_length(brand) <= 80),
  condition text not null default 'new' check (condition in ('new', 'used', 'refurbished')),
  status text not null default 'draft'
    check (status in ('draft', 'pending_review', 'changes_requested', 'approved', 'rejected', 'archived')),
  review_note text check (review_note is null or char_length(review_note) <= 1000),
  weight_grams integer check (weight_grams is null or weight_grams between 1 and 100000),
  length_cm integer check (length_cm is null or length_cm between 1 and 300),
  width_cm integer check (width_cm is null or width_cm between 1 and 300),
  height_cm integer check (height_cm is null or height_cm between 1 and 300),
  shipping_requirements text check (shipping_requirements is null or char_length(shipping_requirements) <= 500),
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) <= 3),
  attributes jsonb not null default '{}'::jsonb check (jsonb_typeof(attributes) = 'object'),
  price_from_kobo bigint,
  total_stock integer not null default 0,
  submitted_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_seller_status_idx on public.products (seller_id, status);
create index products_status_updated_idx on public.products (status, updated_at desc);
create index products_live_category_idx on public.products (category_id) where status = 'approved';
create index products_live_price_idx on public.products (price_from_kobo) where status = 'approved';
create trigger products_set_updated_at before update on public.products
  for each row execute function public.set_updated_at();

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  seller_id uuid not null references public.sellers (id) on delete restrict,
  sku text check (sku is null or (char_length(sku) between 1 and 60 and sku ~ '^[A-Za-z0-9._/-]+$')),
  option_values jsonb not null default '{}'::jsonb check (jsonb_typeof(option_values) = 'object'),
  price_kobo bigint not null check (price_kobo between 1 and 10000000000),
  sale_price_kobo bigint check (sale_price_kobo is null or (sale_price_kobo >= 1 and sale_price_kobo < price_kobo)),
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, option_values)
);
create unique index product_variants_sku_idx on public.product_variants (seller_id, lower(sku)) where sku is not null;
create trigger product_variants_set_updated_at before update on public.product_variants
  for each row execute function public.set_updated_at();

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  seller_id uuid not null references public.sellers (id) on delete restrict,
  storage_path text not null unique check (char_length(storage_path) <= 300),
  alt_text text check (alt_text is null or char_length(alt_text) <= 150),
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index product_images_product_idx on public.product_images (product_id, position);

create table public.product_events (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  from_status text,
  to_status text not null,
  actor_id uuid,
  note text check (note is null or char_length(note) <= 1000),
  created_at timestamptz not null default now()
);
create index product_events_product_idx on public.product_events (product_id, created_at);

-- Immutable stock ledger: every change to stock_quantity is recorded here.
create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.product_variants (id) on delete restrict,
  product_id uuid not null,
  seller_id uuid not null,
  delta integer not null check (delta <> 0),
  reason text not null check (reason in ('initial', 'restock', 'adjustment', 'correction', 'sale', 'cancellation', 'return')),
  quantity_after integer not null check (quantity_after >= 0),
  actor_id uuid,
  reference text check (reference is null or char_length(reference) <= 100),
  note text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now()
);
create index inventory_movements_variant_idx on public.inventory_movements (variant_id, created_at desc);
create index inventory_movements_product_idx on public.inventory_movements (product_id, created_at desc);

create or replace function public.block_append_only_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end;
$$;
create trigger inventory_movements_no_update_delete before update or delete on public.inventory_movements
  for each row execute function public.block_append_only_changes();
create trigger inventory_movements_no_truncate before truncate on public.inventory_movements
  for each statement execute function public.block_append_only_changes();

-- ------------------------------------------------------------------ triggers that hold the invariants
create or replace function public.products_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_content boolean;
  v_detail boolean;
begin
  if new.options is distinct from old.options then
    raise exception 'product options cannot be changed after creation' using errcode = '23514';
  end if;
  v_content := (new.name, new.description, new.brand, new.condition, new.category_id, new.attributes)
    is distinct from (old.name, old.description, old.brand, old.condition, old.category_id, old.attributes);
  v_detail := v_content or (new.weight_grams, new.length_cm, new.width_cm, new.height_cm, new.shipping_requirements)
    is distinct from (old.weight_grams, old.length_cm, old.width_cm, old.height_cm, old.shipping_requirements);

  if old.status = new.status then
    if old.status = 'pending_review' and v_detail then
      raise exception 'withdraw the listing from review before editing it' using errcode = '23514';
    end if;
    if old.status = 'archived' and v_detail then
      raise exception 'restore the listing before editing it' using errcode = '23514';
    end if;
    if old.status = 'approved' and v_content then
      -- A live listing whose content changes goes back to review and leaves the catalogue until re-approved.
      new.status := 'pending_review';
      new.submitted_at := now();
      new.approved_at := null;
      insert into public.product_events (product_id, from_status, to_status, note)
      values (old.id, 'approved', 'pending_review', 'Edited while live; sent for re-review');
    end if;
  end if;
  return new;
end;
$$;
create trigger products_before_update before update on public.products
  for each row execute function public.products_before_update();

create or replace function public.product_images_before_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_status text;
begin
  select status into v_status from public.products where id = new.product_id;
  if v_status is null or v_status in ('pending_review', 'archived') then
    raise exception 'images cannot be changed while the listing is %', coalesce(replace(v_status, '_', ' '), 'missing') using errcode = '23514';
  end if;
  if (select count(*) from public.product_images where product_id = new.product_id) >= 8 then
    raise exception 'image limit reached (8)' using errcode = '23514';
  end if;
  new.position := coalesce((select max(position) + 1 from public.product_images where product_id = new.product_id), 0);
  return new;
end;
$$;
create trigger product_images_before_insert before insert on public.product_images
  for each row execute function public.product_images_before_insert();

create or replace function public.product_images_before_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_status text;
begin
  select status into v_status from public.products where id = old.product_id;
  if v_status in ('pending_review', 'archived') then
    raise exception 'images cannot be changed while the listing is %', replace(v_status, '_', ' ') using errcode = '23514';
  end if;
  return old;
end;
$$;
create trigger product_images_before_delete before delete on public.product_images
  for each row execute function public.product_images_before_delete();

-- Changing the pictures of a live listing sends it back to review.
create or replace function public.product_images_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_product uuid := coalesce(new.product_id, old.product_id);
begin
  if exists (select 1 from public.products where id = v_product and status = 'approved') then
    update public.products set status = 'pending_review', submitted_at = now(), approved_at = null where id = v_product;
    insert into public.product_events (product_id, from_status, to_status, note)
    values (v_product, 'approved', 'pending_review', 'Images changed while live; sent for re-review');
  end if;
  return null;
end;
$$;
create trigger product_images_after_change after insert or delete on public.product_images
  for each row execute function public.product_images_after_change();

-- Keep price_from_kobo and total_stock on the product in step with its active variants.
create or replace function public.refresh_product_rollups()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_product uuid := coalesce(new.product_id, old.product_id);
begin
  update public.products p set
    price_from_kobo = (select min(coalesce(v.sale_price_kobo, v.price_kobo)) from public.product_variants v where v.product_id = p.id and v.is_active),
    total_stock = coalesce((select sum(v.stock_quantity) from public.product_variants v where v.product_id = p.id and v.is_active), 0)
  where p.id = v_product;
  return null;
end;
$$;
create trigger product_variants_rollups after insert or update or delete on public.product_variants
  for each row execute function public.refresh_product_rollups();

-- ------------------------------------------------------------------ functions
create or replace function public.generate_product_slug(p_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_base text; v_candidate text;
begin
  v_base := btrim(left(public.slugify(p_name), 70), '-');
  if char_length(v_base) < 3 then v_base := 'product'; end if;
  loop
    v_candidate := v_base || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 6);
    exit when not exists (select 1 from public.products where slug = v_candidate);
  end loop;
  return v_candidate;
end;
$$;

-- What is still missing before a listing can be submitted or approved (empty = ready).
create or replace function public.product_missing(p_product uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare pr public.products%rowtype; m text[] := '{}';
begin
  select * into pr from public.products where id = p_product;
  if not found then return array['product']; end if;
  if char_length(coalesce(btrim(pr.description), '')) < 20 then m := array_append(m, 'description (20+ characters)'::text); end if;
  if pr.category_id is null or not exists (select 1 from public.categories c where c.id = pr.category_id and c.is_active and c.fulfilment = 'physical') then
    m := array_append(m, 'category'::text);
  end if;
  if pr.weight_grams is null then m := array_append(m, 'weight'::text); end if;
  if not exists (select 1 from public.product_variants v where v.product_id = pr.id and v.is_active) then
    m := array_append(m, 'at least one active variant'::text);
  end if;
  if not exists (select 1 from public.product_images i where i.product_id = pr.id) then
    m := array_append(m, 'at least one image'::text);
  end if;
  return m;
end;
$$;

create or replace function public.assert_variant_options(p_options jsonb, p_values jsonb)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare o jsonb; v text; n integer;
begin
  if jsonb_typeof(p_values) <> 'object' then
    raise exception 'option values must be an object' using errcode = '22023';
  end if;
  select count(*) into n from jsonb_object_keys(p_values);
  if n <> jsonb_array_length(p_options) then
    raise exception 'a variant must choose one value for each option' using errcode = '22023';
  end if;
  for o in select * from jsonb_array_elements(p_options) loop
    v := p_values ->> (o ->> 'name');
    if v is null or not exists (select 1 from jsonb_array_elements_text(o -> 'values') x where x = v) then
      raise exception 'invalid value for option %', o ->> 'name' using errcode = '22023';
    end if;
  end loop;
end;
$$;

-- Core stock mutation. One atomic UPDATE that refuses to go below zero, plus an immutable ledger row.
create or replace function public.apply_stock_movement(
  p_variant uuid, p_delta integer, p_reason text, p_actor uuid, p_reference text default null, p_note text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_after integer; v_product uuid; v_seller uuid;
begin
  if p_delta is null or p_delta = 0 then
    raise exception 'quantity change must not be zero' using errcode = '22023';
  end if;
  update public.product_variants
  set stock_quantity = stock_quantity + p_delta
  where id = p_variant and stock_quantity + p_delta >= 0
  returning stock_quantity, product_id, seller_id into v_after, v_product, v_seller;
  if not found then
    if exists (select 1 from public.product_variants where id = p_variant) then
      raise exception 'insufficient stock' using errcode = '23514';
    end if;
    raise exception 'variant not found' using errcode = 'P0002';
  end if;
  insert into public.inventory_movements (variant_id, product_id, seller_id, delta, reason, quantity_after, actor_id, reference, note)
  values (p_variant, v_product, v_seller, p_delta, p_reason, v_after, p_actor, p_reference, p_note);
  return v_after;
end;
$$;

create or replace function public.seller_adjust_stock(p_seller uuid, p_variant uuid, p_delta integer, p_reason text, p_note text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_owner uuid; v_user uuid; v_status text;
begin
  if p_reason not in ('restock', 'adjustment', 'correction') then
    raise exception 'invalid reason' using errcode = '22023';
  end if;
  select seller_id into v_owner from public.product_variants where id = p_variant;
  if v_owner is null then raise exception 'variant not found' using errcode = 'P0002'; end if;
  if v_owner <> p_seller then raise exception 'not your product' using errcode = '42501'; end if;
  select status, user_id into v_status, v_user from public.sellers where id = p_seller;
  if v_status <> 'active' then raise exception 'seller account is not active' using errcode = '42501'; end if;
  return public.apply_stock_movement(p_variant, p_delta, p_reason, v_user, null, nullif(btrim(coalesce(p_note, '')), ''));
end;
$$;

create or replace function public.create_product(p_seller uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text; v_id uuid; v_variant jsonb; v_vid uuid; v_stock integer; v_user uuid;
  v_options jsonb := coalesce(p -> 'options', '[]'::jsonb);
  v_category uuid := nullif(p ->> 'categoryId', '')::uuid;
begin
  select status, user_id into v_status, v_user from public.sellers where id = p_seller;
  if v_status is null then raise exception 'seller not found' using errcode = 'P0002'; end if;
  if v_status <> 'active' then raise exception 'seller account is not active' using errcode = '42501'; end if;
  if jsonb_typeof(p -> 'variants') is distinct from 'array' or jsonb_array_length(p -> 'variants') = 0 then
    raise exception 'at least one variant is required' using errcode = '22023';
  end if;
  if (select count(*) from public.products where seller_id = p_seller) >= 1000 then
    raise exception 'product limit reached' using errcode = '23514';
  end if;
  if v_category is not null and not exists (
       select 1 from public.categories c where c.id = v_category and c.is_active and c.fulfilment = 'physical') then
    raise exception 'invalid category' using errcode = '22023';
  end if;

  insert into public.products (seller_id, category_id, slug, name, description, brand, condition, weight_grams,
    length_cm, width_cm, height_cm, shipping_requirements, options, attributes)
  values (p_seller, v_category, public.generate_product_slug(p ->> 'name'), btrim(p ->> 'name'),
    nullif(btrim(coalesce(p ->> 'description', '')), ''), nullif(btrim(coalesce(p ->> 'brand', '')), ''),
    coalesce(nullif(p ->> 'condition', ''), 'new'), nullif(p ->> 'weightGrams', '')::integer,
    nullif(p ->> 'lengthCm', '')::integer, nullif(p ->> 'widthCm', '')::integer, nullif(p ->> 'heightCm', '')::integer,
    nullif(btrim(coalesce(p ->> 'shippingRequirements', '')), ''), v_options, coalesce(p -> 'attributes', '{}'::jsonb))
  returning id into v_id;

  insert into public.product_events (product_id, from_status, to_status, actor_id) values (v_id, null, 'draft', v_user);

  for v_variant in select * from jsonb_array_elements(p -> 'variants') loop
    perform public.assert_variant_options(v_options, coalesce(v_variant -> 'optionValues', '{}'::jsonb));
    insert into public.product_variants (product_id, seller_id, sku, option_values, price_kobo, sale_price_kobo)
    values (v_id, p_seller, nullif(btrim(coalesce(v_variant ->> 'sku', '')), ''), coalesce(v_variant -> 'optionValues', '{}'::jsonb),
      (v_variant ->> 'priceKobo')::bigint, nullif(v_variant ->> 'salePriceKobo', '')::bigint)
    returning id into v_vid;
    v_stock := coalesce(nullif(v_variant ->> 'initialStock', '')::integer, 0);
    if v_stock > 0 then
      perform public.apply_stock_movement(v_vid, v_stock, 'initial', v_user, null, null);
    end if;
  end loop;
  return v_id;
end;
$$;

create or replace function public.add_variant(p_seller uuid, p_product uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare pr public.products%rowtype; v_vid uuid; v_stock integer; v_user uuid; v_sstatus text;
begin
  select * into pr from public.products where id = p_product for update;
  if not found then raise exception 'product not found' using errcode = 'P0002'; end if;
  if pr.seller_id <> p_seller then raise exception 'not your product' using errcode = '42501'; end if;
  select status, user_id into v_sstatus, v_user from public.sellers where id = p_seller;
  if v_sstatus <> 'active' then raise exception 'seller account is not active' using errcode = '42501'; end if;
  if pr.status in ('pending_review', 'archived') then
    raise exception 'variants cannot be added while the listing is %', replace(pr.status, '_', ' ') using errcode = '23514';
  end if;
  if (select count(*) from public.product_variants where product_id = p_product) >= 100 then
    raise exception 'variant limit reached (100)' using errcode = '23514';
  end if;
  perform public.assert_variant_options(pr.options, coalesce(p -> 'optionValues', '{}'::jsonb));
  insert into public.product_variants (product_id, seller_id, sku, option_values, price_kobo, sale_price_kobo)
  values (p_product, p_seller, nullif(btrim(coalesce(p ->> 'sku', '')), ''), coalesce(p -> 'optionValues', '{}'::jsonb),
    (p ->> 'priceKobo')::bigint, nullif(p ->> 'salePriceKobo', '')::bigint)
  returning id into v_vid;
  v_stock := coalesce(nullif(p ->> 'initialStock', '')::integer, 0);
  if v_stock > 0 then
    perform public.apply_stock_movement(v_vid, v_stock, 'initial', v_user, null, null);
  end if;
  return v_vid;
end;
$$;

create or replace function public.seller_change_product_status(p_seller uuid, p_product uuid, p_action text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare pr public.products%rowtype; v_to text; v_missing text[]; v_user uuid; v_sstatus text;
begin
  select * into pr from public.products where id = p_product for update;
  if not found then raise exception 'product not found' using errcode = 'P0002'; end if;
  if pr.seller_id <> p_seller then raise exception 'not your product' using errcode = '42501'; end if;
  select status, user_id into v_sstatus, v_user from public.sellers where id = p_seller;
  if v_sstatus <> 'active' then raise exception 'seller account is not active' using errcode = '42501'; end if;

  if p_action = 'submit' and pr.status in ('draft', 'changes_requested', 'rejected') then
    v_missing := public.product_missing(pr.id);
    if cardinality(v_missing) > 0 then
      raise exception 'listing is incomplete: %', array_to_string(v_missing, ', ') using errcode = '22023';
    end if;
    v_to := 'pending_review';
  elsif p_action = 'withdraw' and pr.status = 'pending_review' then v_to := 'draft';
  elsif p_action = 'archive' and pr.status in ('draft', 'changes_requested', 'rejected', 'approved') then v_to := 'archived';
  elsif p_action = 'restore' and pr.status = 'archived' then v_to := 'draft';
  elsif p_action not in ('submit', 'withdraw', 'archive', 'restore') then
    raise exception 'unknown action' using errcode = '22023';
  else
    raise exception 'cannot % a listing that is %', p_action, replace(pr.status, '_', ' ') using errcode = '23514';
  end if;

  update public.products
  set status = v_to,
      review_note = case when v_to = 'pending_review' then null else review_note end,
      submitted_at = case when v_to = 'pending_review' then now() else submitted_at end,
      approved_at = case when v_to <> 'approved' then null else approved_at end
  where id = pr.id;
  insert into public.product_events (product_id, from_status, to_status, actor_id) values (pr.id, pr.status, v_to, v_user);
  return v_to;
end;
$$;

create or replace function public.review_product(p_actor uuid, p_product uuid, p_action text, p_note text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare pr public.products%rowtype; v_to text; v_note text := nullif(btrim(coalesce(p_note, '')), ''); v_missing text[]; v_owner uuid;
begin
  if p_actor is null or p_product is null or p_action is null then
    raise exception 'actor, product and action are required' using errcode = '22023';
  end if;
  if not public.user_has_permission(p_actor, 'catalog.moderate') then
    raise exception 'missing permission catalog.moderate' using errcode = '42501';
  end if;
  select * into pr from public.products where id = p_product for update;
  if not found then raise exception 'product not found' using errcode = 'P0002'; end if;
  select user_id into v_owner from public.sellers where id = pr.seller_id;
  if v_owner = p_actor then raise exception 'you cannot review your own listing' using errcode = '42501'; end if;
  if pr.status <> 'pending_review' then
    raise exception 'only listings awaiting review can be decided (this one is %)', replace(pr.status, '_', ' ') using errcode = '23514';
  end if;

  if p_action = 'approve' then v_to := 'approved';
  elsif p_action = 'request_changes' then v_to := 'changes_requested';
  elsif p_action = 'reject' then v_to := 'rejected';
  else raise exception 'unknown action' using errcode = '22023';
  end if;
  if p_action in ('request_changes', 'reject') and (v_note is null or char_length(v_note) < 5) then
    raise exception 'a note of at least 5 characters is required' using errcode = '22023';
  end if;
  if p_action = 'approve' then
    v_missing := public.product_missing(pr.id);
    if cardinality(v_missing) > 0 then
      raise exception 'listing is incomplete: %', array_to_string(v_missing, ', ') using errcode = '22023';
    end if;
  end if;

  update public.products
  set status = v_to, review_note = v_note,
      approved_at = case when v_to = 'approved' then now() else null end,
      approved_by = case when v_to = 'approved' then p_actor else null end
  where id = pr.id;
  insert into public.product_events (product_id, from_status, to_status, actor_id, note) values (pr.id, pr.status, v_to, p_actor, v_note);
  perform public.write_audit_log(p_actor, 'product.' || p_action, 'product', pr.id::text, jsonb_build_object('from', pr.status, 'to', v_to));
  return v_to;
end;
$$;

create or replace function public.create_category(p_actor uuid, p_name text, p_parent uuid default null, p_sort integer default 100)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_base text; v_slug text; v_n integer := 1; v_id uuid;
begin
  if not public.user_has_permission(p_actor, 'categories.manage') then
    raise exception 'missing permission categories.manage' using errcode = '42501';
  end if;
  v_base := btrim(left(public.slugify(p_name), 70), '-');
  if char_length(v_base) < 2 then raise exception 'invalid category name' using errcode = '22023'; end if;
  v_slug := v_base;
  while exists (select 1 from public.categories where slug = v_slug) loop
    v_n := v_n + 1;
    v_slug := v_base || '-' || v_n::text;
  end loop;
  insert into public.categories (parent_id, slug, name, sort_order) values (p_parent, v_slug, btrim(p_name), p_sort) returning id into v_id;
  perform public.write_audit_log(p_actor, 'category.created', 'category', v_id::text, jsonb_build_object('name', btrim(p_name)));
  return v_id;
end;
$$;

create or replace function public.update_category(p_actor uuid, p_id uuid, p_name text, p_sort integer, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.user_has_permission(p_actor, 'categories.manage') then
    raise exception 'missing permission categories.manage' using errcode = '42501';
  end if;
  update public.categories set name = btrim(p_name), sort_order = p_sort, is_active = p_active where id = p_id;
  if not found then raise exception 'category not found' using errcode = 'P0002'; end if;
  perform public.write_audit_log(p_actor, 'category.updated', 'category', p_id::text,
    jsonb_build_object('name', btrim(p_name), 'active', p_active));
end;
$$;

-- ------------------------------------------------------------------ RLS and grants
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.product_images enable row level security;
alter table public.product_events enable row level security;
alter table public.inventory_movements enable row level security;

revoke all on public.categories, public.products, public.product_variants, public.product_images,
  public.product_events, public.inventory_movements from anon, authenticated;
grant select on public.categories, public.products, public.product_variants, public.product_images,
  public.product_events, public.inventory_movements to authenticated;
grant select, insert, update, delete on public.categories, public.products, public.product_variants,
  public.product_images, public.product_events to service_role;
grant select, insert on public.inventory_movements to service_role;
revoke update, delete, truncate on public.inventory_movements from service_role;

create policy categories_select_active on public.categories
  for select to authenticated using (is_active or (select public.has_permission('categories.manage')));

create policy products_select_own on public.products
  for select to authenticated using (exists (select 1 from public.sellers s where s.id = seller_id and s.user_id = (select auth.uid())));
create policy products_select_staff on public.products
  for select to authenticated using ((select public.has_permission('catalog.moderate')));

create policy variants_select_own on public.product_variants
  for select to authenticated using (exists (select 1 from public.sellers s where s.id = seller_id and s.user_id = (select auth.uid())));
create policy variants_select_staff on public.product_variants
  for select to authenticated using ((select public.has_permission('catalog.moderate')));

create policy images_select_own on public.product_images
  for select to authenticated using (exists (select 1 from public.sellers s where s.id = seller_id and s.user_id = (select auth.uid())));
create policy images_select_staff on public.product_images
  for select to authenticated using ((select public.has_permission('catalog.moderate')));

create policy product_events_select_own on public.product_events
  for select to authenticated using (exists (
    select 1 from public.products p join public.sellers s on s.id = p.seller_id
    where p.id = product_id and s.user_id = (select auth.uid())));
create policy product_events_select_staff on public.product_events
  for select to authenticated using ((select public.has_permission('catalog.moderate')));

create policy movements_select_own on public.inventory_movements
  for select to authenticated using (exists (select 1 from public.sellers s where s.id = seller_id and s.user_id = (select auth.uid())));
create policy movements_select_staff on public.inventory_movements
  for select to authenticated using ((select public.has_permission('catalog.moderate')));
-- Public catalogue reads and all writes go through the API (service_role); anon has no table access.

revoke all on function public.categories_before_write() from public, anon, authenticated;
revoke all on function public.block_append_only_changes() from public, anon, authenticated;
revoke all on function public.products_before_update() from public, anon, authenticated;
revoke all on function public.product_images_before_insert() from public, anon, authenticated;
revoke all on function public.product_images_before_delete() from public, anon, authenticated;
revoke all on function public.product_images_after_change() from public, anon, authenticated;
revoke all on function public.refresh_product_rollups() from public, anon, authenticated;
revoke all on function public.generate_product_slug(text) from public, anon, authenticated;
revoke all on function public.product_missing(uuid) from public, anon, authenticated;
revoke all on function public.assert_variant_options(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.apply_stock_movement(uuid, integer, text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.seller_adjust_stock(uuid, uuid, integer, text, text) from public, anon, authenticated;
revoke all on function public.create_product(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.add_variant(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.seller_change_product_status(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.review_product(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.create_category(uuid, text, uuid, integer) from public, anon, authenticated;
revoke all on function public.update_category(uuid, uuid, text, integer, boolean) from public, anon, authenticated;

grant execute on function public.product_missing(uuid) to service_role;
grant execute on function public.apply_stock_movement(uuid, integer, text, uuid, text, text) to service_role;
grant execute on function public.seller_adjust_stock(uuid, uuid, integer, text, text) to service_role;
grant execute on function public.create_product(uuid, jsonb) to service_role;
grant execute on function public.add_variant(uuid, uuid, jsonb) to service_role;
grant execute on function public.seller_change_product_status(uuid, uuid, text) to service_role;
grant execute on function public.review_product(uuid, uuid, text, text) to service_role;
grant execute on function public.create_category(uuid, text, uuid, integer) to service_role;
grant execute on function public.update_category(uuid, uuid, text, integer, boolean) to service_role;
