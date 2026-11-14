-- ONWA SQL tests for Stage 4: cart, checkout, stock reservation, order workflow, expiry, RLS.
-- Run on a DISPOSABLE database after migrations 0001-0013 (same method as the other test files).
-- Supabase SQL Editor: delete the final \echo line before running. Everything is rolled back at the end.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a4', 'seller4@example.test', '{"full_name":"Seller Four"}'),
  ('00000000-0000-0000-0000-0000000000a5', 'seller5@example.test', '{"full_name":"Seller Five"}'),
  ('00000000-0000-0000-0000-0000000000b4', 'buyer4@example.test', '{"full_name":"Buyer Four"}'),
  ('00000000-0000-0000-0000-0000000000b5', 'buyer5@example.test', '{"full_name":"Buyer Five"}'),
  ('00000000-0000-0000-0000-0000000000c4', 'carol4@example.test', '{"full_name":"Carol Admin"}'),
  ('00000000-0000-0000-0000-0000000000e4', 'erin4@example.test', '{"full_name":"Erin Support"}');

insert into public.user_roles (user_id, role_id) select '00000000-0000-0000-0000-0000000000c4', id from public.roles where code = 'super_admin';
insert into public.user_roles (user_id, role_id) select '00000000-0000-0000-0000-0000000000e4', id from public.roles where code = 'customer_support';

-- Setup: two sellers, one live product each (stock 10, price 1000.00 naira, sale price on seller 4's), addresses.
do $$
declare v_app uuid; v_seller uuid; u uuid; v_p uuid; v_cat uuid := (select id from public.categories where slug = 'fashion-clothing');
begin
  foreach u in array array['00000000-0000-0000-0000-0000000000a4'::uuid, '00000000-0000-0000-0000-0000000000a5'::uuid] loop
    insert into public.seller_applications (user_id, status) values (u, 'approved') returning id into v_app;
    insert into public.sellers (user_id, application_id) values (u, v_app) returning id into v_seller;
    insert into public.stores (seller_id, slug, name) values (v_seller, 'shop-' || substr(u::text, 33, 4), 'Shop ' || substr(u::text, 33, 4));
    v_p := public.create_product(v_seller, jsonb_build_object('name', 'Test Item ' || substr(u::text, 33, 4), 'categoryId', v_cat,
      'description', 'A product used only inside the test suite.', 'weightGrams', 300,
      'options', '[{"name":"Size","values":["S","M"]}]'::jsonb,
      'variants', jsonb_build_array(
        jsonb_build_object('optionValues', '{"Size":"S"}'::jsonb, 'priceKobo', 100000, 'salePriceKobo', 90000, 'initialStock', 10),
        jsonb_build_object('optionValues', '{"Size":"M"}'::jsonb, 'priceKobo', 120000, 'initialStock', 4))));
    update public.products set status = 'approved' where id = v_p;
  end loop;
  insert into public.addresses (user_id, recipient_name, phone, line1, city, lga, state)
  select u2, 'Test Recipient', '+2348031234567', '1 Test Road', 'Enugu', 'Enugu North', 'Enugu'
  from unnest(array['00000000-0000-0000-0000-0000000000b4'::uuid, '00000000-0000-0000-0000-0000000000b5'::uuid, '00000000-0000-0000-0000-0000000000a4'::uuid]) u2;
end $$;

-- 1. Cart -----------------------------------------------------------------------------------
do $$
declare
  v_s4 uuid := (select id from public.sellers where user_id = '00000000-0000-0000-0000-0000000000a4');
  v_var uuid := (select v.id from public.product_variants v join public.products p on p.id = v.product_id where p.seller_id = v_s4 and v.option_values = '{"Size":"S"}'::jsonb);
  v_draft uuid; v_item uuid;
begin
  set local role service_role;
  perform public.cart_add_item('00000000-0000-0000-0000-0000000000b4', v_var, 2);
  perform public.cart_add_item('00000000-0000-0000-0000-0000000000b4', v_var, 1);
  select ci.id into v_item from public.cart_items ci join public.carts c on c.id = ci.cart_id where c.user_id = '00000000-0000-0000-0000-0000000000b4';
  if (select quantity from public.cart_items where id = v_item) <> 3 then raise exception 'FAIL: quantities did not add up'; end if;

  begin perform public.cart_add_item('00000000-0000-0000-0000-0000000000b4', v_var, 8); raise exception 'FAIL: added more than stock';
  exception when check_violation then null; end;
  begin perform public.cart_add_item('00000000-0000-0000-0000-0000000000b4', v_var, 0); raise exception 'FAIL: zero quantity accepted';
  exception when invalid_parameter_value then null; end;
  begin perform public.cart_add_item('00000000-0000-0000-0000-0000000000a4', v_var, 1); raise exception 'FAIL: seller bought own product';
  exception when insufficient_privilege then null; end;
  begin perform public.cart_add_item('00000000-0000-0000-0000-0000000000b4', gen_random_uuid(), 1); raise exception 'FAIL: unknown variant accepted';
  exception when no_data_found then null; end;

  -- a draft (unapproved) product cannot be added
  update public.products set status = 'draft' where seller_id = v_s4;
  begin perform public.cart_add_item('00000000-0000-0000-0000-0000000000b5', v_var, 1); raise exception 'FAIL: unapproved product added to cart';
  exception when check_violation then null; end;
  update public.products set status = 'approved' where seller_id = v_s4;

  begin perform public.cart_set_quantity('00000000-0000-0000-0000-0000000000b4', v_item, 11); raise exception 'FAIL: set above stock';
  exception when check_violation then null; end;
  begin perform public.cart_set_quantity('00000000-0000-0000-0000-0000000000b5', v_item, 1); raise exception 'FAIL: changed another user''s cart';
  exception when no_data_found then null; end;
  perform public.cart_set_quantity('00000000-0000-0000-0000-0000000000b4', v_item, 2);
  reset role;
end $$;

-- 2. Checkout, reservation, idempotency, atomic failure ------------------------------------
do $$
declare
  v_s4 uuid := (select id from public.sellers where user_id = '00000000-0000-0000-0000-0000000000a4');
  v_s5 uuid := (select id from public.sellers where user_id = '00000000-0000-0000-0000-0000000000a5');
  v_var uuid := (select v.id from public.product_variants v join public.products p on p.id = v.product_id where p.seller_id = v_s4 and v.option_values = '{"Size":"S"}'::jsonb);
  v_addr uuid := (select id from public.addresses where user_id = '00000000-0000-0000-0000-0000000000b4');
  v_key uuid := gen_random_uuid(); v_order uuid; v_again uuid; v_n integer; v_stock integer;
begin
  set local role service_role;
  v_order := public.create_order('00000000-0000-0000-0000-0000000000b4', v_s4, v_addr, 'Leave at the gate', v_key);

  select stock_quantity into v_stock from public.product_variants where id = v_var;
  if v_stock <> 8 then raise exception 'FAIL: stock after reserving 2 should be 8, got %', v_stock; end if;
  if (select total_kobo from public.orders where id = v_order) <> 180000 then raise exception 'FAIL: total should use the sale price (2 x 900.00)'; end if;
  if (select status from public.orders where id = v_order) <> 'pending_payment' then raise exception 'FAIL: new order not pending payment'; end if;
  if (select expires_at from public.orders where id = v_order) < now() + interval '29 minutes' then raise exception 'FAIL: expiry window'; end if;
  if (select order_number from public.orders where id = v_order) < 100001 then raise exception 'FAIL: order number'; end if;
  select count(*) into v_n from public.order_items oi join public.seller_orders so on so.id = oi.seller_order_id where so.order_id = v_order and oi.unit_price_kobo = 90000 and oi.quantity = 2 and oi.variant_label = 'S';
  if v_n <> 1 then raise exception 'FAIL: item snapshot missing or wrong'; end if;
  if exists (select 1 from public.cart_items ci join public.carts c on c.id = ci.cart_id where c.user_id = '00000000-0000-0000-0000-0000000000b4') then
    raise exception 'FAIL: cart not emptied after checkout';
  end if;
  if (select count(*) from public.inventory_movements where variant_id = v_var and reason = 'sale' and delta = -2) <> 1 then raise exception 'FAIL: sale movement'; end if;

  -- the same submission twice creates one order and reserves stock once
  v_again := public.create_order('00000000-0000-0000-0000-0000000000b4', v_s4, v_addr, 'Leave at the gate', v_key);
  if v_again <> v_order then raise exception 'FAIL: idempotency key created a second order'; end if;
  select stock_quantity into v_stock from public.product_variants where id = v_var;
  if v_stock <> 8 then raise exception 'FAIL: stock reserved twice'; end if;

  -- price changes after ordering do not alter the order
  update public.product_variants set sale_price_kobo = null, price_kobo = 500000 where id = v_var;
  if (select total_kobo from public.orders where id = v_order) <> 180000 then raise exception 'FAIL: order total followed a price change'; end if;
  update public.product_variants set sale_price_kobo = 90000, price_kobo = 100000 where id = v_var;

  -- atomic failure: cart quantity became unavailable -> nothing is created, nothing is reserved
  perform public.cart_add_item('00000000-0000-0000-0000-0000000000b5', v_var, 8);
  perform public.apply_stock_movement(v_var, -3, 'adjustment', null, 'test', null);
  select count(*) into v_n from public.orders;
  begin
    perform public.create_order('00000000-0000-0000-0000-0000000000b5', v_s4, (select id from public.addresses where user_id = '00000000-0000-0000-0000-0000000000b5'), null, gen_random_uuid());
    raise exception 'FAIL: oversold at checkout';
  exception when check_violation then null; end;
  if (select count(*) from public.orders) <> v_n then raise exception 'FAIL: a partial order was left behind'; end if;
  select stock_quantity into v_stock from public.product_variants where id = v_var;
  if v_stock <> 5 then raise exception 'FAIL: stock changed by a failed checkout (got %)', v_stock; end if;
  perform public.apply_stock_movement(v_var, 3, 'adjustment', null, 'test', null);

  -- other validation
  begin perform public.create_order('00000000-0000-0000-0000-0000000000b5', v_s4, v_addr, null, gen_random_uuid()); raise exception 'FAIL: used another user''s address';
  exception when no_data_found then null; end;
  begin perform public.create_order('00000000-0000-0000-0000-0000000000b5', v_s5, (select id from public.addresses where user_id = '00000000-0000-0000-0000-0000000000b5'), null, gen_random_uuid()); raise exception 'FAIL: ordered with no items for that store';
  exception when invalid_parameter_value then null; end;
  begin perform public.create_order('00000000-0000-0000-0000-0000000000a4', v_s4, (select id from public.addresses where user_id = '00000000-0000-0000-0000-0000000000a4'), null, gen_random_uuid()); raise exception 'FAIL: seller ordered own store';
  exception when insufficient_privilege or invalid_parameter_value then null; end;
  reset role;
end $$;

-- 3. Cancel returns stock; only the right people can cancel --------------------------------
do $$
declare
  v_s4 uuid := (select id from public.sellers where user_id = '00000000-0000-0000-0000-0000000000a4');
  v_var uuid := (select v.id from public.product_variants v join public.products p on p.id = v.product_id where p.seller_id = v_s4 and v.option_values = '{"Size":"S"}'::jsonb);
  v_so uuid := (select so.id from public.seller_orders so join public.orders o on o.id = so.order_id where o.buyer_id = '00000000-0000-0000-0000-0000000000b4' limit 1);
  v_before integer;
begin
  set local role service_role;
  select stock_quantity into v_before from public.product_variants where id = v_var;
  begin perform public.change_order_status('00000000-0000-0000-0000-0000000000b5', v_so, 'cancel'); raise exception 'FAIL: a stranger cancelled the order';
  exception when no_data_found then null; end;
  begin perform public.change_order_status('00000000-0000-0000-0000-0000000000a4', v_so, 'cancel'); raise exception 'FAIL: seller cancelled an unpaid order';
  exception when insufficient_privilege then null; end;
  begin perform public.change_order_status('00000000-0000-0000-0000-0000000000e4', v_so, 'cancel'); raise exception 'FAIL: support without orders.manage cancelled';
  exception when no_data_found then null; end;
  begin perform public.change_order_status('00000000-0000-0000-0000-0000000000b4', v_so, 'start_processing'); raise exception 'FAIL: buyer started processing';
  exception when insufficient_privilege then null; end;

  perform public.change_order_status('00000000-0000-0000-0000-0000000000b4', v_so, 'cancel', 'Changed my mind');
  if (select stock_quantity from public.product_variants where id = v_var) <> v_before + 2 then raise exception 'FAIL: stock not returned on cancel'; end if;
  if (select status from public.orders where id = (select order_id from public.seller_orders where id = v_so)) <> 'cancelled' then raise exception 'FAIL: parent order not cancelled'; end if;
  begin perform public.change_order_status('00000000-0000-0000-0000-0000000000b4', v_so, 'cancel'); raise exception 'FAIL: cancelled twice (stock returned twice)';
  exception when check_violation then null; end;
  if (select count(*) from public.inventory_movements where variant_id = v_var and reason = 'cancellation') <> 1 then raise exception 'FAIL: expected one cancellation movement'; end if;
  begin perform public.mark_order_paid((select order_id from public.seller_orders where id = v_so), 'late-ref'); raise exception 'FAIL: cancelled order marked paid';
  exception when check_violation then null; end;
  reset role;
end $$;

-- 4. Expiry ---------------------------------------------------------------------------------
do $$
declare
  v_s4 uuid := (select id from public.sellers where user_id = '00000000-0000-0000-0000-0000000000a4');
  v_var uuid := (select v.id from public.product_variants v join public.products p on p.id = v.product_id where p.seller_id = v_s4 and v.option_values = '{"Size":"M"}'::jsonb);
  v_order uuid; v_before integer; v_n integer;
begin
  set local role service_role;
  perform public.cart_add_item('00000000-0000-0000-0000-0000000000b4', v_var, 2);
  v_order := public.create_order('00000000-0000-0000-0000-0000000000b4', v_s4, (select id from public.addresses where user_id = '00000000-0000-0000-0000-0000000000b4'), null, gen_random_uuid());
  if (select stock_quantity from public.product_variants where id = v_var) <> 2 then raise exception 'FAIL: reservation'; end if;
  if public.expire_unpaid_orders() <> 0 then raise exception 'FAIL: expired an order inside its window'; end if;
  reset role;
  update public.orders set expires_at = now() - interval '1 minute' where id = v_order;
  set local role service_role;
  v_n := public.expire_unpaid_orders();
  if v_n <> 1 then raise exception 'FAIL: expected 1 expired order, got %', v_n; end if;
  if (select stock_quantity from public.product_variants where id = v_var) <> 4 then raise exception 'FAIL: expiry did not return stock'; end if;
  if (select status from public.orders where id = v_order) <> 'cancelled' then raise exception 'FAIL: expired order not cancelled'; end if;
  if public.expire_unpaid_orders() <> 0 then raise exception 'FAIL: expiry not idempotent'; end if;
  reset role;
end $$;

-- 5. Paid workflow, actor rules, return window, staff audit ------------------------------------
do $$
declare
  v_s4 uuid := (select id from public.sellers where user_id = '00000000-0000-0000-0000-0000000000a4');
  v_var uuid := (select v.id from public.product_variants v join public.products p on p.id = v.product_id where p.seller_id = v_s4 and v.option_values = '{"Size":"S"}'::jsonb);
  v_order uuid; v_so uuid; v_order2 uuid; v_so2 uuid;
  b uuid := '00000000-0000-0000-0000-0000000000b4'; s uuid := '00000000-0000-0000-0000-0000000000a4'; c uuid := '00000000-0000-0000-0000-0000000000c4';
begin
  set local role service_role;
  perform public.cart_add_item(b, v_var, 1);
  v_order := public.create_order(b, v_s4, (select id from public.addresses where user_id = b), null, gen_random_uuid());
  v_so := (select id from public.seller_orders where order_id = v_order);

  begin perform public.change_order_status(s, v_so, 'start_processing'); raise exception 'FAIL: processed an unpaid order';
  exception when check_violation then null; end;

  perform public.mark_order_paid(v_order, 'TEST-REF-1');
  if (select status from public.seller_orders where id = v_so) <> 'paid' then raise exception 'FAIL: not paid'; end if;
  begin perform public.mark_order_paid(v_order, 'TEST-REF-1'); raise exception 'FAIL: paid twice';
  exception when check_violation then null; end;
  begin perform public.change_order_status(b, v_so, 'cancel'); raise exception 'FAIL: cancelled a paid order without the refund flow';
  exception when check_violation then null; end;
  begin perform public.change_order_status(b, v_so, 'start_processing'); raise exception 'FAIL: buyer processed own order';
  exception when insufficient_privilege then null; end;
  begin perform public.change_order_status(s, v_so, 'dispatch'); raise exception 'FAIL: skipped processing steps';
  exception when check_violation then null; end;

  perform public.change_order_status(s, v_so, 'start_processing');
  perform public.change_order_status(s, v_so, 'mark_ready');
  perform public.change_order_status(s, v_so, 'dispatch');
  perform public.change_order_status(s, v_so, 'mark_in_transit');
  begin perform public.change_order_status(s, v_so, 'confirm_received'); raise exception 'FAIL: seller confirmed receipt for the buyer';
  exception when insufficient_privilege then null; end;
  perform public.change_order_status(s, v_so, 'mark_delivered');
  if (select delivered_at from public.seller_orders where id = v_so) is null then raise exception 'FAIL: delivered_at not set'; end if;

  -- return window
  reset role;
  update public.seller_orders set delivered_at = now() - interval '8 days' where id = v_so;
  set local role service_role;
  begin perform public.change_order_status(b, v_so, 'request_return'); raise exception 'FAIL: return accepted after the window';
  exception when check_violation then null; end;
  perform public.change_order_status(b, v_so, 'confirm_received');
  if (select status from public.seller_orders where id = v_so) <> 'completed' then raise exception 'FAIL: not completed'; end if;
  if (select count(*) from public.order_status_history where seller_order_id = v_so) < 7 then raise exception 'FAIL: status history incomplete'; end if;

  -- return inside the window
  perform public.cart_add_item(b, v_var, 1);
  v_order2 := public.create_order(b, v_s4, (select id from public.addresses where user_id = b), null, gen_random_uuid());
  v_so2 := (select id from public.seller_orders where order_id = v_order2);
  perform public.mark_order_paid(v_order2, 'TEST-REF-2');
  perform public.change_order_status(s, v_so2, 'start_processing'); perform public.change_order_status(s, v_so2, 'mark_ready');
  perform public.change_order_status(s, v_so2, 'dispatch'); perform public.change_order_status(s, v_so2, 'mark_in_transit');
  perform public.change_order_status(s, v_so2, 'mark_delivered');
  perform public.change_order_status(b, v_so2, 'request_return', 'Wrong size');
  if (select status from public.seller_orders where id = v_so2) <> 'return_requested' then raise exception 'FAIL: return not requested'; end if;

  -- staff with orders.manage can cancel an unpaid order and it is audited
  perform public.cart_add_item(b, v_var, 1);
  v_order := public.create_order(b, v_s4, (select id from public.addresses where user_id = b), null, gen_random_uuid());
  perform public.change_order_status(c, (select id from public.seller_orders where order_id = v_order), 'cancel', 'Customer asked support');
  if not exists (select 1 from public.audit_logs where action = 'order.cancel') then raise exception 'FAIL: staff cancellation not audited'; end if;

  -- history and items are immutable
  begin update public.order_status_history set note = 'tampered'; raise exception 'FAIL: history updated';
  exception when insufficient_privilege then null; end;
  begin update public.order_items set quantity = 50; raise exception 'FAIL: order item updated';
  exception when insufficient_privilege then null; end;
  reset role;
end $$;

-- 6. RLS and privileges -------------------------------------------------------------------
do $$
declare v_n integer; v_paid uuid; v_unpaid_so uuid;
begin
  -- an unpaid order for seller 4 (buyer 5); clear leftover cart lines from the failed-checkout test first
  delete from public.cart_items ci using public.carts c where c.id = ci.cart_id and c.user_id = '00000000-0000-0000-0000-0000000000b5';
  set local role service_role;
  perform public.cart_add_item('00000000-0000-0000-0000-0000000000b5', (select v.id from public.product_variants v join public.products p on p.id = v.product_id
    where p.seller_id = (select id from public.sellers where user_id = '00000000-0000-0000-0000-0000000000a4') and v.option_values = '{"Size":"S"}'::jsonb), 1);
  v_paid := public.create_order('00000000-0000-0000-0000-0000000000b5', (select id from public.sellers where user_id = '00000000-0000-0000-0000-0000000000a4'),
    (select id from public.addresses where user_id = '00000000-0000-0000-0000-0000000000b5'), null, gen_random_uuid());
  reset role;

  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b5","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into v_n from public.orders; if v_n <> 1 then raise exception 'FAIL: buyer 5 sees % orders', v_n; end if;
  select count(*) into v_n from public.order_items; if v_n <> 1 then raise exception 'FAIL: buyer 5 sees % items', v_n; end if;
  begin update public.orders set status = 'paid'; raise exception 'FAIL: buyer marked own order paid';
  exception when insufficient_privilege then null; end;
  begin perform public.mark_order_paid(v_paid, 'x'); raise exception 'FAIL: client called mark_order_paid';
  exception when insufficient_privilege then null; end;
  begin perform public.create_order('00000000-0000-0000-0000-0000000000b5', gen_random_uuid(), gen_random_uuid(), null, gen_random_uuid()); raise exception 'FAIL: client called create_order';
  exception when insufficient_privilege then null; end;
  begin perform public.change_order_status('00000000-0000-0000-0000-0000000000b5', gen_random_uuid(), 'cancel'); raise exception 'FAIL: client called change_order_status';
  exception when insufficient_privilege then null; end;
  begin insert into public.carts (user_id) values ('00000000-0000-0000-0000-0000000000b5'); raise exception 'FAIL: client wrote a cart directly';
  exception when insufficient_privilege then null; end;
  reset role;

  -- buyer 4 does not see buyer 5's order
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b4","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into v_n from public.orders where id = v_paid; if v_n <> 0 then raise exception 'FAIL: buyer 4 sees buyer 5''s order'; end if;
  reset role;

  -- seller 4 sees paid orders only (completed/returned ones from section 5), never the unpaid one
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a4","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into v_n from public.seller_orders where order_id = v_paid; if v_n <> 0 then raise exception 'FAIL: seller sees an unpaid order'; end if;
  select count(*) into v_n from public.seller_orders; if v_n < 2 then raise exception 'FAIL: seller cannot see their paid orders'; end if;
  reset role;

  -- seller 5 (other store) sees nothing; support/staff visibility follows permissions
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a5","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into v_n from public.seller_orders; if v_n <> 0 then raise exception 'FAIL: another seller sees orders'; end if;
  reset role;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c4","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into v_n from public.orders; if v_n < 3 then raise exception 'FAIL: staff with orders.read cannot see orders'; end if;
  reset role;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e4","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into v_n from public.orders; if v_n < 3 then raise exception 'FAIL: support (orders.read) cannot see orders'; end if;
  reset role;

  set local role anon;
  begin perform 1 from public.orders limit 1; raise exception 'FAIL: anon read orders'; exception when insufficient_privilege then null; end;
  begin perform 1 from public.carts limit 1; raise exception 'FAIL: anon read carts'; exception when insufficient_privilege then null; end;
  reset role;

  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity) then
    raise exception 'FAIL: a public table has RLS disabled';
  end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon') then
    raise exception 'FAIL: anon has table grants in public';
  end if;
end $$;

rollback;

\echo 'ALL STAGE 4 SQL TESTS PASSED (transaction rolled back)'
