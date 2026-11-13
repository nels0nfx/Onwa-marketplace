-- ONWA SQL tests for Stage 3: categories, products, variants, stock, listing review, RLS.
-- Run on a DISPOSABLE database after migrations 0001-0012 (same method as the other test files).
-- Supabase SQL Editor: delete the final \echo line before running. Everything is rolled back at the end.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a3', 'seller3@example.test', '{"full_name":"Seller Three"}'),
  ('00000000-0000-0000-0000-0000000000b3', 'bob3@example.test', '{"full_name":"Bob Three"}'),
  ('00000000-0000-0000-0000-0000000000c3', 'carol3@example.test', '{"full_name":"Carol Admin"}'),
  ('00000000-0000-0000-0000-0000000000d3', 'dan3@example.test', '{"full_name":"Dan Other Seller"}'),
  ('00000000-0000-0000-0000-0000000000e3', 'erin3@example.test', '{"full_name":"Erin Support"}');

insert into public.user_roles (user_id, role_id)
select '00000000-0000-0000-0000-0000000000c3', id from public.roles where code = 'super_admin';
insert into public.user_roles (user_id, role_id)
select '00000000-0000-0000-0000-0000000000e3', id from public.roles where code = 'customer_support';

-- Two approved sellers (set up directly; the approval workflow is covered by test 002).
do $$
declare v_app uuid; v_seller uuid; u uuid;
begin
  foreach u in array array['00000000-0000-0000-0000-0000000000a3'::uuid, '00000000-0000-0000-0000-0000000000d3'::uuid] loop
    insert into public.seller_applications (user_id, status) values (u, 'approved') returning id into v_app;
    insert into public.sellers (user_id, application_id) values (u, v_app) returning id into v_seller;
    insert into public.stores (seller_id, slug, name) values (v_seller, 'store-' || substr(u::text, 33, 4), 'Store ' || substr(u::text, 33, 4));
  end loop;
end $$;

-- 1. Categories ---------------------------------------------------------------
do $$
declare v_parent uuid; v_child uuid;
begin
  if (select count(*) from public.categories where parent_id is null and fulfilment = 'physical') < 14 then
    raise exception 'FAIL: starter categories missing';
  end if;
  set local role service_role;
  begin
    perform public.create_category('00000000-0000-0000-0000-0000000000e3', 'Shoes');
    raise exception 'FAIL: customer_support created a category';
  exception when insufficient_privilege then null;
  end;
  v_parent := public.create_category('00000000-0000-0000-0000-0000000000c3', 'Shoes', null, 5);
  v_child := public.create_category('00000000-0000-0000-0000-0000000000c3', 'Running Shoes', v_parent, 5);
  if (select slug from public.categories where id = v_parent) <> 'shoes' then raise exception 'FAIL: slug'; end if;
  if public.create_category('00000000-0000-0000-0000-0000000000c3', 'Shoes') is null then raise exception 'FAIL: dup'; end if;
  if not exists (select 1 from public.categories where slug = 'shoes-2') then
    raise exception 'FAIL: duplicate slug not suffixed';
  end if;
  begin
    perform public.create_category('00000000-0000-0000-0000-0000000000c3', 'Third Level', v_child);
    raise exception 'FAIL: three-level category accepted';
  exception when check_violation then null;
  end;
  reset role;
end $$;

-- 2. Create product with options; rollups; initial stock movements ------------------------------
do $$
declare
  v_seller uuid := (select id from public.sellers where user_id = '00000000-0000-0000-0000-0000000000a3');
  v_cat uuid := (select id from public.categories where slug = 'fashion-clothing');
  v_p uuid; v_n integer; v_price bigint; v_stock integer;
begin
  set local role service_role;
  v_p := public.create_product(v_seller, jsonb_build_object(
    'name', 'Ankara Tote Bag', 'categoryId', v_cat, 'description', 'A sturdy handmade tote bag for everyday use.',
    'weightGrams', 400, 'options', '[{"name":"Size","values":["S","M"]}]'::jsonb,
    'variants', jsonb_build_array(
      jsonb_build_object('optionValues', '{"Size":"S"}'::jsonb, 'priceKobo', 1500000, 'initialStock', 5),
      jsonb_build_object('optionValues', '{"Size":"M"}'::jsonb, 'priceKobo', 1800000, 'salePriceKobo', 1600000, 'initialStock', 3))));
  select price_from_kobo, total_stock into v_price, v_stock from public.products where id = v_p;
  if v_price <> 1500000 then raise exception 'FAIL: price_from_kobo is %', v_price; end if;
  if v_stock <> 8 then raise exception 'FAIL: total_stock is %', v_stock; end if;
  select count(*) into v_n from public.inventory_movements where product_id = v_p and reason = 'initial';
  if v_n <> 2 then raise exception 'FAIL: expected 2 initial movements, got %', v_n; end if;
  if (select status from public.products where id = v_p) <> 'draft' then raise exception 'FAIL: new product not draft'; end if;
  if (select slug from public.products where id = v_p) !~ '^ankara-tote-bag-[0-9a-f]{6}$' then raise exception 'FAIL: slug format'; end if;

  begin
    perform public.create_product(v_seller, jsonb_build_object('name', 'Bad', 'options', '[{"name":"Size","values":["S"]}]'::jsonb,
      'variants', jsonb_build_array(jsonb_build_object('optionValues', '{"Size":"XL"}'::jsonb, 'priceKobo', 1000))));
    raise exception 'FAIL: variant with unlisted option value accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.create_product(v_seller, jsonb_build_object('name', 'Dup', 'variants', jsonb_build_array(
      jsonb_build_object('priceKobo', 1000), jsonb_build_object('priceKobo', 2000))));
    raise exception 'FAIL: duplicate variant combination accepted';
  exception when unique_violation then null;
  end;
  begin
    perform public.create_product(v_seller, '{"name":"No variants","variants":[]}'::jsonb);
    raise exception 'FAIL: product without variants accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.create_product(v_seller, jsonb_build_object('name', 'Free', 'variants', jsonb_build_array(jsonb_build_object('priceKobo', 0))));
    raise exception 'FAIL: zero price accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.create_product(v_seller, jsonb_build_object('name', 'Sale', 'variants', jsonb_build_array(
      jsonb_build_object('priceKobo', 1000, 'salePriceKobo', 1000))));
    raise exception 'FAIL: sale price equal to price accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.create_product(v_seller, jsonb_build_object('name', 'Cat', 'categoryId', gen_random_uuid(),
      'variants', jsonb_build_array(jsonb_build_object('priceKobo', 1000))));
    raise exception 'FAIL: unknown category accepted';
  exception when invalid_parameter_value then null;
  end;
  reset role;
end $$;

-- 3. Stock can never oversell or go negative; movements are immutable --------------------------
do $$
declare
  v_seller uuid := (select id from public.sellers where user_id = '00000000-0000-0000-0000-0000000000a3');
  v_other uuid := (select id from public.sellers where user_id = '00000000-0000-0000-0000-0000000000d3');
  v_variant uuid := (select v.id from public.product_variants v join public.products p on p.id = v.product_id
                     where p.seller_id = (select id from public.sellers where user_id = '00000000-0000-0000-0000-0000000000a3')
                       and v.option_values = '{"Size":"S"}'::jsonb limit 1);
  v_after integer;
begin
  set local role service_role;
  v_after := public.seller_adjust_stock(v_seller, v_variant, 10, 'restock');
  if v_after <> 15 then raise exception 'FAIL: restock gave %', v_after; end if;
  begin
    perform public.seller_adjust_stock(v_seller, v_variant, -16, 'correction');
    raise exception 'FAIL: stock went below zero';
  exception when check_violation then null;
  end;
  if (select stock_quantity from public.product_variants where id = v_variant) <> 15 then raise exception 'FAIL: stock changed by a refused adjustment'; end if;
  begin
    perform public.seller_adjust_stock(v_other, v_variant, 1, 'restock');
    raise exception 'FAIL: another seller adjusted stock';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.seller_adjust_stock(v_seller, v_variant, 1, 'sale');
    raise exception 'FAIL: seller recorded a sale';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.seller_adjust_stock(v_seller, v_variant, 0, 'restock');
    raise exception 'FAIL: zero adjustment accepted';
  exception when invalid_parameter_value then null;
  end;
  -- the platform path (checkout, Stage 4): exact sell-out works, one more fails
  perform public.apply_stock_movement(v_variant, -15, 'sale', null, 'order-test', null);
  begin
    perform public.apply_stock_movement(v_variant, -1, 'sale', null, 'order-test-2', null);
    raise exception 'FAIL: oversold';
  exception when check_violation then null;
  end;
  begin
    update public.product_variants set stock_quantity = -1 where id = v_variant;
    raise exception 'FAIL: negative stock written directly';
  exception when check_violation then null;
  end;
  -- ledger is immutable
  begin
    update public.inventory_movements set delta = 99;
    raise exception 'FAIL: movement updated';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.inventory_movements;
    raise exception 'FAIL: movement deleted';
  exception when insufficient_privilege then null;
  end;
  -- ledger reconciles with stock
  if (select coalesce(sum(delta), 0) from public.inventory_movements where variant_id = v_variant)
     <> (select stock_quantity from public.product_variants where id = v_variant) then
    raise exception 'FAIL: movements do not add up to stock';
  end if;
  reset role;
end $$;

-- 4. Listing workflow -----------------------------------------------------------------
do $$
declare
  v_seller uuid := (select id from public.sellers where user_id = '00000000-0000-0000-0000-0000000000a3');
  v_other uuid := (select id from public.sellers where user_id = '00000000-0000-0000-0000-0000000000d3');
  v_p uuid := (select id from public.products where seller_id = (select id from public.sellers where user_id = '00000000-0000-0000-0000-0000000000a3') limit 1);
  v_variant uuid := (select id from public.product_variants where product_id = (select id from public.products where seller_id = (select id from public.sellers where user_id = '00000000-0000-0000-0000-0000000000a3') limit 1) limit 1);
  v_to text;
begin
  set local role service_role;

  begin
    perform public.seller_change_product_status(v_seller, v_p, 'submit');
    raise exception 'FAIL: submitted without an image';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.seller_change_product_status(v_other, v_p, 'submit');
    raise exception 'FAIL: another seller changed my listing status';
  exception when insufficient_privilege then null;
  end;

  insert into public.product_images (product_id, seller_id, storage_path) values (v_p, v_seller, v_seller || '/' || v_p || '/a.png');
  if (select position from public.product_images where product_id = v_p) <> 0 then raise exception 'FAIL: first image position'; end if;

  v_to := public.seller_change_product_status(v_seller, v_p, 'submit');
  if v_to <> 'pending_review' then raise exception 'FAIL: submit gave %', v_to; end if;

  begin
    update public.products set name = 'Sneaky rename' where id = v_p;
    raise exception 'FAIL: edited a listing while pending review';
  exception when check_violation then null;
  end;
  begin
    insert into public.product_images (product_id, seller_id, storage_path) values (v_p, v_seller, v_seller || '/' || v_p || '/b.png');
    raise exception 'FAIL: image added during review';
  exception when check_violation then null;
  end;
  begin
    update public.products set options = '[]'::jsonb where id = v_p;
    raise exception 'FAIL: options changed';
  exception when check_violation then null;
  end;

  -- review permissions
  begin
    perform public.review_product('00000000-0000-0000-0000-0000000000e3', v_p, 'approve');
    raise exception 'FAIL: customer_support approved a listing';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.review_product('00000000-0000-0000-0000-0000000000c3', v_p, 'request_changes');
    raise exception 'FAIL: request_changes without a note';
  exception when invalid_parameter_value then null;
  end;
  v_to := public.review_product('00000000-0000-0000-0000-0000000000c3', v_p, 'request_changes', 'Please add a clearer main photo');
  if v_to <> 'changes_requested' then raise exception 'FAIL: request_changes gave %', v_to; end if;
  begin
    perform public.review_product('00000000-0000-0000-0000-0000000000c3', v_p, 'approve');
    raise exception 'FAIL: approved a listing that is not pending';
  exception when check_violation then null;
  end;

  -- fix and resubmit, then approve
  update public.products set description = 'A sturdy handmade tote bag for everyday use, with a zip.' where id = v_p;
  perform public.seller_change_product_status(v_seller, v_p, 'submit');
  v_to := public.review_product('00000000-0000-0000-0000-0000000000c3', v_p, 'approve');
  if v_to <> 'approved' then raise exception 'FAIL: approve gave %', v_to; end if;

  -- live listing: price edits are free; content or image edits send it back to review
  update public.product_variants set price_kobo = 1700000 where id = v_variant;
  if (select status from public.products where id = v_p) <> 'approved' then raise exception 'FAIL: a price edit changed the status'; end if;
  update public.products set weight_grams = 450 where id = v_p;
  if (select status from public.products where id = v_p) <> 'approved' then raise exception 'FAIL: a weight edit changed the status'; end if;
  update public.products set description = 'Changed marketing claims that need a fresh review.' where id = v_p;
  if (select status from public.products where id = v_p) <> 'pending_review' then raise exception 'FAIL: content edit did not trigger re-review'; end if;
  perform public.review_product('00000000-0000-0000-0000-0000000000c3', v_p, 'approve');
  insert into public.product_images (product_id, seller_id, storage_path) values (v_p, v_seller, v_seller || '/' || v_p || '/c.png');
  if (select status from public.products where id = v_p) <> 'pending_review' then raise exception 'FAIL: image change did not trigger re-review'; end if;

  -- withdraw, archive, restore
  perform public.seller_change_product_status(v_seller, v_p, 'withdraw');
  begin
    perform public.seller_change_product_status(v_seller, v_p, 'restore');
    raise exception 'FAIL: restored a non-archived listing';
  exception when check_violation then null;
  end;
  perform public.seller_change_product_status(v_seller, v_p, 'archive');
  begin
    update public.products set name = 'Edit while archived' where id = v_p;
    raise exception 'FAIL: archived listing edited';
  exception when check_violation then null;
  end;
  perform public.seller_change_product_status(v_seller, v_p, 'restore');
  if (select status from public.products where id = v_p) <> 'draft' then raise exception 'FAIL: restore did not give draft'; end if;

  if (select count(*) from public.product_events where product_id = v_p) < 8 then raise exception 'FAIL: expected a product history'; end if;
  if (select count(*) from public.audit_logs where action like 'product.%') < 3 then raise exception 'FAIL: expected moderation audit rows'; end if;
  reset role;
end $$;

-- 5. RLS ---------------------------------------------------------------------------------
do $$
declare v_n integer;
begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into v_n from public.products;
  if v_n <> 1 then raise exception 'FAIL: seller sees % products', v_n; end if;
  select count(*) into v_n from public.product_variants;
  if v_n < 2 then raise exception 'FAIL: seller cannot see own variants'; end if;
  begin
    update public.products set status = 'approved';
    raise exception 'FAIL: seller self-approved through a direct update';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.product_variants set stock_quantity = 9999;
    raise exception 'FAIL: seller changed stock directly';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.inventory_movements (variant_id, product_id, seller_id, delta, reason, quantity_after)
    select id, product_id, seller_id, 1, 'restock', 1 from public.product_variants limit 1;
    raise exception 'FAIL: seller wrote an inventory movement directly';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.create_product((select id from public.sellers limit 1), '{}'::jsonb);
    raise exception 'FAIL: client executed create_product';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.review_product('00000000-0000-0000-0000-0000000000a3', gen_random_uuid(), 'approve');
    raise exception 'FAIL: client executed review_product';
  exception when insufficient_privilege then null;
  end;
  select count(*) into v_n from public.categories;
  if v_n < 14 then raise exception 'FAIL: authenticated cannot read active categories'; end if;
  reset role;

  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d3","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into v_n from public.products;
  if v_n <> 0 then raise exception 'FAIL: another seller sees % products', v_n; end if;
  select count(*) into v_n from public.inventory_movements;
  if v_n <> 0 then raise exception 'FAIL: another seller sees inventory movements'; end if;
  reset role;

  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b3","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into v_n from public.products;
  if v_n <> 0 then raise exception 'FAIL: a customer sees % products directly', v_n; end if;
  reset role;

  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into v_n from public.products;
  if v_n < 1 then raise exception 'FAIL: moderator cannot see products'; end if;
  reset role;

  set local role anon;
  begin
    perform 1 from public.products limit 1;
    raise exception 'FAIL: anon read products';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.categories limit 1;
    raise exception 'FAIL: anon read categories';
  exception when insufficient_privilege then null;
  end;
  reset role;
end $$;

-- 6. Structure --------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity) then
    raise exception 'FAIL: a public table has RLS disabled';
  end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon') then
    raise exception 'FAIL: anon has table grants in public';
  end if;
  if to_regclass('storage.buckets') is not null and
     (select public from storage.buckets where id = 'product-media') is distinct from true then
    raise exception 'FAIL: product-media bucket missing or not public';
  end if;
end $$;

rollback;

\echo 'ALL STAGE 3 SQL TESTS PASSED (transaction rolled back)'
