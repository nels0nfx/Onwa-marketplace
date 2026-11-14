-- ONWA 0013: cart, checkout and orders (physical fulfilment).
-- Parent order + one seller order per seller. Stock is reserved atomically when the order is placed and
-- returned when it is cancelled or expires. Payment confirmation is NOT possible from the API: mark_order_paid
-- exists for the verified payment webhook added in Stage 5 and is executable by service_role only.
-- Seller-order statuses (physical): pending_payment, paid, processing, ready_for_dispatch, dispatched, in_transit,
-- delivered, completed, cancelled, return_requested, returned, refund_pending, refunded.

-- ------------------------------------------------------------------ cart
create table public.carts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts (id) on delete cascade,
  variant_id uuid not null references public.product_variants (id) on delete cascade,
  quantity integer not null check (quantity between 1 and 99),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cart_id, variant_id)
);
create trigger cart_items_set_updated_at before update on public.cart_items
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------ orders
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint generated always as identity (start with 100001),
  buyer_id uuid not null references public.profiles (id) on delete restrict,
  status text not null default 'pending_payment' check (status in ('pending_payment', 'paid', 'cancelled')),
  currency text not null default 'NGN' check (currency = 'NGN'),
  subtotal_kobo bigint not null default 0 check (subtotal_kobo >= 0),
  shipping_kobo bigint not null default 0 check (shipping_kobo >= 0),
  total_kobo bigint not null default 0,
  shipping_address jsonb not null check (jsonb_typeof(shipping_address) = 'object'),
  note text check (note is null or char_length(note) <= 300),
  idempotency_key uuid not null,
  expires_at timestamptz,
  paid_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_total_matches check (total_kobo = subtotal_kobo + shipping_kobo),
  unique (buyer_id, idempotency_key)
);
create unique index orders_order_number_idx on public.orders (order_number);
create index orders_buyer_idx on public.orders (buyer_id, created_at desc);
create index orders_expiry_idx on public.orders (expires_at) where status = 'pending_payment';
create trigger orders_set_updated_at before update on public.orders
  for each row execute function public.set_updated_at();

create table public.seller_orders (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  seller_id uuid not null references public.sellers (id) on delete restrict,
  order_type text not null default 'physical' check (order_type in ('physical')),
  status text not null default 'pending_payment' check (status in (
    'pending_payment', 'paid', 'processing', 'ready_for_dispatch', 'dispatched', 'in_transit', 'delivered', 'completed',
    'cancelled', 'return_requested', 'returned', 'refund_pending', 'refunded')),
  subtotal_kobo bigint not null default 0 check (subtotal_kobo >= 0),
  shipping_kobo bigint not null default 0 check (shipping_kobo >= 0),
  total_kobo bigint not null default 0,
  paid_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seller_orders_total_matches check (total_kobo = subtotal_kobo + shipping_kobo),
  unique (order_id, seller_id)
);
create index seller_orders_seller_idx on public.seller_orders (seller_id, created_at desc);
create index seller_orders_status_idx on public.seller_orders (status);
create trigger seller_orders_set_updated_at before update on public.seller_orders
  for each row execute function public.set_updated_at();

-- Immutable snapshot of what was bought, at the price paid.
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  seller_order_id uuid not null references public.seller_orders (id) on delete restrict,
  product_id uuid not null references public.products (id) on delete restrict,
  variant_id uuid not null references public.product_variants (id) on delete restrict,
  product_name text not null,
  variant_label text not null,
  sku text,
  image_path text,
  unit_price_kobo bigint not null check (unit_price_kobo >= 1),
  quantity integer not null check (quantity between 1 and 99),
  line_total_kobo bigint not null,
  created_at timestamptz not null default now(),
  constraint order_items_line_total check (line_total_kobo = unit_price_kobo * quantity)
);
create index order_items_seller_order_idx on public.order_items (seller_order_id);
create trigger order_items_no_update_delete before update or delete on public.order_items
  for each row execute function public.block_append_only_changes();

create table public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  seller_order_id uuid not null references public.seller_orders (id) on delete restrict,
  from_status text,
  to_status text not null,
  actor_id uuid,
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now()
);
create index order_status_history_idx on public.order_status_history (seller_order_id, created_at);
create trigger order_status_history_no_update_delete before update or delete on public.order_status_history
  for each row execute function public.block_append_only_changes();

-- ------------------------------------------------------------------ cart functions
create or replace function public.cart_add_item(p_user uuid, p_variant uuid, p_qty integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active boolean; v_stock integer; v_pstatus text; v_sstatus text; v_seller_user uuid;
  v_cart uuid; v_existing integer; v_new integer;
begin
  if p_qty is null or p_qty < 1 or p_qty > 99 then
    raise exception 'quantity must be between 1 and 99' using errcode = '22023';
  end if;
  select v.is_active, v.stock_quantity, p.status, s.status, s.user_id
    into v_active, v_stock, v_pstatus, v_sstatus, v_seller_user
  from public.product_variants v
  join public.products p on p.id = v.product_id
  join public.sellers s on s.id = p.seller_id
  where v.id = p_variant;
  if not found then raise exception 'item not found' using errcode = 'P0002'; end if;
  if not v_active or v_pstatus <> 'approved' or v_sstatus <> 'active' then
    raise exception 'this item is not available' using errcode = '23514';
  end if;
  if v_seller_user = p_user then
    raise exception 'you cannot buy your own product' using errcode = '42501';
  end if;

  insert into public.carts (user_id) values (p_user) on conflict (user_id) do nothing;
  select id into v_cart from public.carts where user_id = p_user;
  select quantity into v_existing from public.cart_items where cart_id = v_cart and variant_id = p_variant;
  v_new := coalesce(v_existing, 0) + p_qty;
  if v_new > 99 then raise exception 'quantity must be between 1 and 99' using errcode = '22023'; end if;
  if v_new > v_stock then
    raise exception 'only % available', v_stock using errcode = '23514';
  end if;
  if v_existing is null and (select count(*) from public.cart_items where cart_id = v_cart) >= 50 then
    raise exception 'your cart is full (50 items)' using errcode = '23514';
  end if;

  insert into public.cart_items (cart_id, variant_id, quantity) values (v_cart, p_variant, v_new)
  on conflict (cart_id, variant_id) do update set quantity = excluded.quantity;
  update public.carts set updated_at = now() where id = v_cart;
end;
$$;

create or replace function public.cart_set_quantity(p_user uuid, p_item uuid, p_qty integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_variant uuid; v_stock integer;
begin
  if p_qty is null or p_qty < 1 or p_qty > 99 then
    raise exception 'quantity must be between 1 and 99' using errcode = '22023';
  end if;
  select ci.variant_id into v_variant
  from public.cart_items ci join public.carts c on c.id = ci.cart_id
  where ci.id = p_item and c.user_id = p_user;
  if v_variant is null then raise exception 'cart item not found' using errcode = 'P0002'; end if;
  select stock_quantity into v_stock from public.product_variants where id = v_variant;
  if p_qty > v_stock then raise exception 'only % available', v_stock using errcode = '23514'; end if;
  update public.cart_items set quantity = p_qty where id = p_item;
end;
$$;

-- ------------------------------------------------------------------ checkout
-- Places the order for ONE seller from the buyer's cart. Prices are read here, never taken from the client.
-- Everything happens in one transaction: if any item is unavailable or out of stock, nothing is created.
create or replace function public.create_order(p_buyer uuid, p_seller uuid, p_address uuid, p_note text, p_key uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing uuid; v_seller_status text; v_seller_user uuid; v_addr public.addresses%rowtype;
  v_order uuid; v_number bigint; v_so uuid; v_cart uuid; v_subtotal bigint := 0; v_count integer := 0;
  r record; v_unit bigint; v_label text; v_image text;
begin
  select id into v_existing from public.orders where buyer_id = p_buyer and idempotency_key = p_key;
  if v_existing is not null then return v_existing; end if;

  select status, user_id into v_seller_status, v_seller_user from public.sellers where id = p_seller;
  if v_seller_status is null then raise exception 'store not found' using errcode = 'P0002'; end if;
  if v_seller_status <> 'active' then raise exception 'this store is not accepting orders' using errcode = '23514'; end if;
  if v_seller_user = p_buyer then raise exception 'you cannot buy your own product' using errcode = '42501'; end if;

  select * into v_addr from public.addresses where id = p_address and user_id = p_buyer;
  if not found then raise exception 'delivery address not found' using errcode = 'P0002'; end if;

  select id into v_cart from public.carts where user_id = p_buyer;
  if v_cart is null then raise exception 'there are no items in your cart for this store' using errcode = '22023'; end if;

  insert into public.orders (buyer_id, shipping_address, note, idempotency_key, expires_at)
  values (p_buyer,
    jsonb_build_object('recipientName', v_addr.recipient_name, 'phone', v_addr.phone, 'line1', v_addr.line1, 'line2', v_addr.line2,
      'city', v_addr.city, 'lga', v_addr.lga, 'state', v_addr.state, 'landmark', v_addr.landmark, 'postalCode', v_addr.postal_code),
    nullif(btrim(coalesce(p_note, '')), ''), p_key, now() + interval '30 minutes')
  returning id, order_number into v_order, v_number;

  insert into public.seller_orders (order_id, seller_id) values (v_order, p_seller) returning id into v_so;

  -- Variants are processed in a fixed order so concurrent checkouts cannot deadlock each other.
  for r in
    select ci.id as item_id, ci.quantity, v.id as variant_id, v.sku, v.price_kobo, v.sale_price_kobo, v.is_active,
           v.option_values, p.id as product_id, p.name, p.status as pstatus, p.options
    from public.cart_items ci
    join public.product_variants v on v.id = ci.variant_id
    join public.products p on p.id = v.product_id
    where ci.cart_id = v_cart and p.seller_id = p_seller
    order by v.id
  loop
    if not r.is_active or r.pstatus <> 'approved' then
      raise exception 'no longer available: %', r.name using errcode = '23514';
    end if;
    v_unit := coalesce(r.sale_price_kobo, r.price_kobo);
    select string_agg(r.option_values ->> (o ->> 'name'), ' / ' order by ord)
      into v_label from jsonb_array_elements(r.options) with ordinality as t(o, ord);
    v_label := coalesce(nullif(v_label, ''), 'Standard');
    select storage_path into v_image from public.product_images where product_id = r.product_id order by position limit 1;

    -- Atomic reservation: raises 'insufficient stock' (and rolls the whole order back) rather than overselling.
    perform public.apply_stock_movement(r.variant_id, -r.quantity, 'sale', p_buyer, 'order:' || v_number::text, null);

    insert into public.order_items (seller_order_id, product_id, variant_id, product_name, variant_label, sku, image_path,
      unit_price_kobo, quantity, line_total_kobo)
    values (v_so, r.product_id, r.variant_id, r.name, v_label, r.sku, v_image, v_unit, r.quantity, v_unit * r.quantity);
    v_subtotal := v_subtotal + v_unit * r.quantity;
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception 'there are no items in your cart for this store' using errcode = '22023';
  end if;
  if v_subtotal > 10000000000 then
    raise exception 'order total is too large' using errcode = '22023';
  end if;

  update public.orders set subtotal_kobo = v_subtotal, total_kobo = v_subtotal where id = v_order;
  update public.seller_orders set subtotal_kobo = v_subtotal, total_kobo = v_subtotal where id = v_so;
  delete from public.cart_items ci using public.product_variants v, public.products p
    where ci.cart_id = v_cart and v.id = ci.variant_id and p.id = v.product_id and p.seller_id = p_seller;
  insert into public.order_status_history (seller_order_id, from_status, to_status, actor_id, note)
  values (v_so, null, 'pending_payment', p_buyer, 'Order placed; stock reserved until payment or expiry');
  return v_order;
end;
$$;

-- ------------------------------------------------------------------ status changes
create or replace function public.change_order_status(p_actor uuid, p_seller_order uuid, p_action text, p_note text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  so public.seller_orders%rowtype; o public.orders%rowtype;
  v_seller_user uuid; v_buyer boolean; v_seller boolean; v_staff boolean;
  v_from text; v_to text; v_ok boolean; it record; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into so from public.seller_orders where id = p_seller_order for update;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
  select * into o from public.orders where id = so.order_id for update;
  select user_id into v_seller_user from public.sellers where id = so.seller_id;

  v_buyer := o.buyer_id = p_actor;
  v_seller := v_seller_user = p_actor;
  v_staff := public.user_has_permission(p_actor, 'orders.manage');
  if not (v_buyer or v_seller or v_staff) then
    raise exception 'order not found' using errcode = 'P0002';
  end if;

  if p_action = 'cancel' then v_from := 'pending_payment'; v_to := 'cancelled'; v_ok := v_buyer or v_staff;
  elsif p_action = 'start_processing' then v_from := 'paid'; v_to := 'processing'; v_ok := v_seller or v_staff;
  elsif p_action = 'mark_ready' then v_from := 'processing'; v_to := 'ready_for_dispatch'; v_ok := v_seller or v_staff;
  elsif p_action = 'dispatch' then v_from := 'ready_for_dispatch'; v_to := 'dispatched'; v_ok := v_seller or v_staff;
  elsif p_action = 'mark_in_transit' then v_from := 'dispatched'; v_to := 'in_transit'; v_ok := v_seller or v_staff;
  elsif p_action = 'mark_delivered' then v_from := 'in_transit'; v_to := 'delivered'; v_ok := v_seller or v_staff;
  elsif p_action = 'confirm_received' then v_from := 'delivered'; v_to := 'completed'; v_ok := v_buyer or v_staff;
  elsif p_action = 'request_return' then v_from := 'delivered'; v_to := 'return_requested'; v_ok := v_buyer;
  else raise exception 'unknown action' using errcode = '22023';
  end if;

  if not v_ok then raise exception 'you cannot do this on this order' using errcode = '42501'; end if;
  if so.status <> v_from then
    raise exception 'cannot % an order that is %', replace(p_action, '_', ' '), replace(so.status, '_', ' ') using errcode = '23514';
  end if;
  if p_action = 'request_return' and (so.delivered_at is null or so.delivered_at < now() - interval '7 days') then
    raise exception 'returns can be requested within 7 days of delivery' using errcode = '23514';
  end if;

  if p_action = 'cancel' then
    for it in select variant_id, quantity from public.order_items where seller_order_id = so.id order by variant_id loop
      perform public.apply_stock_movement(it.variant_id, it.quantity, 'cancellation', p_actor, 'order:' || o.order_number::text, null);
    end loop;
  end if;

  update public.seller_orders
  set status = v_to, delivered_at = case when v_to = 'delivered' then now() else delivered_at end
  where id = so.id;

  if p_action = 'cancel' and not exists (
       select 1 from public.seller_orders x where x.order_id = o.id and x.status <> 'cancelled') then
    update public.orders set status = 'cancelled', cancelled_at = now() where id = o.id;
  end if;

  insert into public.order_status_history (seller_order_id, from_status, to_status, actor_id, note)
  values (so.id, so.status, v_to, p_actor, v_note);
  if v_staff and not (v_buyer or v_seller) then
    perform public.write_audit_log(p_actor, 'order.' || p_action, 'seller_order', so.id::text, jsonb_build_object('from', so.status, 'to', v_to));
  end if;
  return v_to;
end;
$$;

-- INTERNAL: called only by the verified payment webhook handler (Stage 5). Never exposed to clients or the browser.
create or replace function public.mark_order_paid(p_order uuid, p_reference text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare o public.orders%rowtype; so record;
begin
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
  if o.status <> 'pending_payment' then
    raise exception 'order is %, not awaiting payment', replace(o.status, '_', ' ') using errcode = '23514';
  end if;
  update public.orders set status = 'paid', paid_at = now(), expires_at = null where id = o.id;
  for so in select id from public.seller_orders where order_id = o.id loop
    update public.seller_orders set status = 'paid', paid_at = now() where id = so.id;
    insert into public.order_status_history (seller_order_id, from_status, to_status, note)
    values (so.id, 'pending_payment', 'paid', 'Payment confirmed' || coalesce(' (' || left(p_reference, 60) || ')', ''));
  end loop;
end;
$$;

-- Cancels unpaid orders whose reservation window has passed and returns their stock. Safe to run repeatedly.
create or replace function public.expire_unpaid_orders(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare r record; so record; it record; v_count integer := 0;
begin
  for r in
    select id, order_number from public.orders
    where status = 'pending_payment' and expires_at is not null and expires_at < now()
    order by expires_at limit greatest(1, least(coalesce(p_limit, 100), 500))
    for update skip locked
  loop
    for so in select id from public.seller_orders where order_id = r.id and status = 'pending_payment' for update loop
      for it in select variant_id, quantity from public.order_items where seller_order_id = so.id order by variant_id loop
        perform public.apply_stock_movement(it.variant_id, it.quantity, 'cancellation', null, 'order:' || r.order_number::text, null);
      end loop;
      update public.seller_orders set status = 'cancelled' where id = so.id;
      insert into public.order_status_history (seller_order_id, from_status, to_status, note)
      values (so.id, 'pending_payment', 'cancelled', 'Expired: payment was not received in time');
    end loop;
    update public.orders set status = 'cancelled', cancelled_at = now() where id = r.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ------------------------------------------------------------------ RLS and grants
alter table public.carts enable row level security;
alter table public.cart_items enable row level security;
alter table public.orders enable row level security;
alter table public.seller_orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_status_history enable row level security;

revoke all on public.carts, public.cart_items, public.orders, public.seller_orders, public.order_items,
  public.order_status_history from anon, authenticated;
grant select on public.carts, public.cart_items, public.orders, public.seller_orders, public.order_items,
  public.order_status_history to authenticated;
grant select, insert, update, delete on public.carts, public.cart_items to service_role;
grant select, insert, update on public.orders, public.seller_orders to service_role;
grant select, insert on public.order_items, public.order_status_history to service_role;

create policy carts_select_own on public.carts
  for select to authenticated using (user_id = (select auth.uid()));
create policy cart_items_select_own on public.cart_items
  for select to authenticated using (exists (select 1 from public.carts c where c.id = cart_id and c.user_id = (select auth.uid())));

create policy orders_select_buyer on public.orders
  for select to authenticated using (buyer_id = (select auth.uid()));
create policy orders_select_staff on public.orders
  for select to authenticated using ((select public.has_permission('orders.read')));

-- Sellers see an order only once it has been paid.
create policy seller_orders_select_buyer on public.seller_orders
  for select to authenticated using (exists (select 1 from public.orders o where o.id = order_id and o.buyer_id = (select auth.uid())));
create policy seller_orders_select_seller on public.seller_orders
  for select to authenticated using (paid_at is not null and exists (
    select 1 from public.sellers s where s.id = seller_id and s.user_id = (select auth.uid())));
create policy seller_orders_select_staff on public.seller_orders
  for select to authenticated using ((select public.has_permission('orders.read')));

create policy order_items_select_visible on public.order_items
  for select to authenticated using (exists (select 1 from public.seller_orders so where so.id = seller_order_id));
create policy order_status_history_select_visible on public.order_status_history
  for select to authenticated using (exists (select 1 from public.seller_orders so where so.id = seller_order_id));
-- order_items / order_status_history rows are visible exactly when their seller order is visible (RLS applies to the subquery).

revoke all on function public.cart_add_item(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.cart_set_quantity(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.create_order(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.change_order_status(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.mark_order_paid(uuid, text) from public, anon, authenticated;
revoke all on function public.expire_unpaid_orders(integer) from public, anon, authenticated;
grant execute on function public.cart_add_item(uuid, uuid, integer) to service_role;
grant execute on function public.cart_set_quantity(uuid, uuid, integer) to service_role;
grant execute on function public.create_order(uuid, uuid, uuid, text, uuid) to service_role;
grant execute on function public.change_order_status(uuid, uuid, text, text) to service_role;
grant execute on function public.mark_order_paid(uuid, text) to service_role;
grant execute on function public.expire_unpaid_orders(integer) to service_role;
