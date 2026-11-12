-- ONWA SQL tests for Stage 2: addresses, seller applications, review workflow, stores, RLS.
-- Run on a DISPOSABLE database after migrations 0001-0010 (same method as 001_rbac_rls.sql).
-- Supabase SQL Editor: delete the final \echo line before running. Everything is rolled back at the end.

begin;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'alice2@example.test', '{"full_name":"Alice Applicant"}'),
  ('00000000-0000-0000-0000-0000000000b1', 'bob2@example.test', '{"full_name":"Bob Bystander"}'),
  ('00000000-0000-0000-0000-0000000000c1', 'carol2@example.test', '{"full_name":"Carol Admin"}'),
  ('00000000-0000-0000-0000-0000000000e1', 'erin2@example.test', '{"full_name":"Erin Support"}'),
  ('00000000-0000-0000-0000-0000000000f1', 'fola2@example.test', '{"full_name":"Fola Applicant"}');

insert into public.user_roles (user_id, role_id)
select '00000000-0000-0000-0000-0000000000c1', id from public.roles where code = 'super_admin';
insert into public.user_roles (user_id, role_id)
select '00000000-0000-0000-0000-0000000000e1', id from public.roles where code = 'customer_support';

-- 1. Addresses ---------------------------------------------------------------
do $$
declare v_n integer; v_first uuid; v_second uuid;
begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
  set local role authenticated;

  insert into public.addresses (user_id, recipient_name, phone, line1, city, lga, state)
  values ('00000000-0000-0000-0000-0000000000a1', 'Alice A', '+2348031234567', '1 Road', 'Enugu', 'Enugu North', 'Enugu')
  returning id into v_first;
  if not (select is_default from public.addresses where id = v_first) then
    raise exception 'FAIL: first address is not default';
  end if;

  insert into public.addresses (user_id, label, recipient_name, phone, line1, city, lga, state, is_default)
  values ('00000000-0000-0000-0000-0000000000a1', 'Work', 'Alice A', '+2348031234567', '2 Road', 'Enugu', 'Enugu North', 'Enugu', true)
  returning id into v_second;
  if (select is_default from public.addresses where id = v_first) or not (select is_default from public.addresses where id = v_second) then
    raise exception 'FAIL: new default did not replace the old default';
  end if;

  begin
    insert into public.addresses (user_id, recipient_name, phone, line1, city, lga, state)
    values ('00000000-0000-0000-0000-0000000000a1', 'Alice A', '+2348031234567', '3 Road', 'Enugu', 'Enugu North', 'Atlantis');
    raise exception 'FAIL: invalid state accepted';
  exception when check_violation then null;
  end;

  begin
    insert into public.addresses (user_id, recipient_name, phone, line1, city, lga, state)
    values ('00000000-0000-0000-0000-0000000000b1', 'Mallory', '+2348031234567', '9 Road', 'Enugu', 'Enugu North', 'Enugu');
    raise exception 'FAIL: alice inserted an address for bob';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.addresses set user_id = '00000000-0000-0000-0000-0000000000b1' where id = v_first;
    raise exception 'FAIL: alice reassigned an address to bob';
  exception when insufficient_privilege then null;
  end;

  -- limit of 10 (two exist already)
  for i in 1..8 loop
    insert into public.addresses (user_id, recipient_name, phone, line1, city, lga, state)
    values ('00000000-0000-0000-0000-0000000000a1', 'Alice A', '+2348031234567', 'Extra ' || i, 'Enugu', 'Enugu North', 'Enugu');
  end loop;
  begin
    insert into public.addresses (user_id, recipient_name, phone, line1, city, lga, state)
    values ('00000000-0000-0000-0000-0000000000a1', 'Alice A', '+2348031234567', 'Eleventh', 'Enugu', 'Enugu North', 'Enugu');
    raise exception 'FAIL: 11th address accepted';
  exception when check_violation then null;
  end;

  -- deleting the default promotes another
  delete from public.addresses where id = v_second;
  select count(*) into v_n from public.addresses where user_id = '00000000-0000-0000-0000-0000000000a1' and is_default;
  if v_n <> 1 then raise exception 'FAIL: expected exactly one default after deleting the default, got %', v_n; end if;
  reset role;

  -- bob sees none of alice's addresses
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into v_n from public.addresses;
  if v_n <> 0 then raise exception 'FAIL: bob sees % addresses', v_n; end if;
  begin
    perform 1 from public.addresses limit 1;
    set local role anon;
    perform 1 from public.addresses limit 1;
    raise exception 'FAIL: anon read addresses';
  exception when insufficient_privilege then null;
  end;
  reset role;
end $$;

-- 2. Seller application workflow (service_role path, as the API does) --------------------
do $$
declare
  v_app uuid; v_to text; v_slug text; v_slug2 text; v_app2 uuid;
  v_draft jsonb := '{
    "legalName":"Alice Applicant","businessName":"Alice Crafts","contactEmail":"alice2@example.test","contactPhone":"+2348031234567",
    "addressLine1":"1 Market Rd","addressCity":"Enugu","addressLga":"Enugu North","addressState":"Enugu",
    "categories":["Art and crafts"],"description":"Handmade crafts sold across Nigeria for several years.",
    "idType":"nin","bankName":"Access Bank","bankAccountNumber":"0123456789","bankAccountName":"Alice Applicant"}';
begin
  set local role service_role;

  v_app := public.save_seller_application('00000000-0000-0000-0000-0000000000a1', v_draft);

  begin
    perform public.submit_seller_application('00000000-0000-0000-0000-0000000000a1');
    raise exception 'FAIL: submitted without identity document';
  exception when invalid_parameter_value then null;
  end;

  insert into public.seller_application_documents (application_id, kind, storage_path, original_name, mime_type, size_bytes)
  values (v_app, 'identity', 'a1/' || v_app || '/x.pdf', 'id.pdf', 'application/pdf', 1000);

  perform public.submit_seller_application('00000000-0000-0000-0000-0000000000a1');
  if (select status from public.seller_applications where id = v_app) <> 'submitted' then
    raise exception 'FAIL: status is not submitted';
  end if;

  -- locked after submission
  begin
    perform public.save_seller_application('00000000-0000-0000-0000-0000000000a1', v_draft);
    raise exception 'FAIL: edited a submitted application';
  exception when check_violation then null;
  end;
  begin
    insert into public.seller_application_documents (application_id, kind, storage_path, original_name, mime_type, size_bytes)
    values (v_app, 'other', 'a1/' || v_app || '/y.pdf', 'y.pdf', 'application/pdf', 1000);
    raise exception 'FAIL: document added to a submitted application';
  exception when check_violation then null;
  end;

  -- who may review
  begin
    perform public.review_seller_application('00000000-0000-0000-0000-0000000000e1', v_app, 'start_review');
    raise exception 'FAIL: customer_support reviewed an application';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.review_seller_application('00000000-0000-0000-0000-0000000000b1', v_app, 'start_review');
    raise exception 'FAIL: a customer reviewed an application';
  exception when insufficient_privilege then null;
  end;

  -- illegal transitions
  begin
    perform public.review_seller_application('00000000-0000-0000-0000-0000000000c1', v_app, 'approve');
    raise exception 'FAIL: approved without review';
  exception when check_violation then null;
  end;

  v_to := public.review_seller_application('00000000-0000-0000-0000-0000000000c1', v_app, 'start_review');
  if v_to <> 'under_review' then raise exception 'FAIL: start_review gave %', v_to; end if;

  begin
    perform public.review_seller_application('00000000-0000-0000-0000-0000000000c1', v_app, 'request_info');
    raise exception 'FAIL: request_info without a note';
  exception when invalid_parameter_value then null;
  end;

  -- more info -> applicant edits -> resubmits
  perform public.review_seller_application('00000000-0000-0000-0000-0000000000c1', v_app, 'request_info', 'Please upload a clearer ID');
  perform public.save_seller_application('00000000-0000-0000-0000-0000000000a1', v_draft);
  perform public.submit_seller_application('00000000-0000-0000-0000-0000000000a1');
  perform public.review_seller_application('00000000-0000-0000-0000-0000000000c1', v_app, 'start_review');

  -- approval creates seller, store and role atomically
  v_to := public.review_seller_application('00000000-0000-0000-0000-0000000000c1', v_app, 'approve');
  if v_to <> 'approved' then raise exception 'FAIL: approve gave %', v_to; end if;
  select s.slug into v_slug from public.stores s join public.sellers sl on sl.id = s.seller_id
    where sl.user_id = '00000000-0000-0000-0000-0000000000a1';
  if v_slug <> 'alice-crafts' then raise exception 'FAIL: unexpected slug %', v_slug; end if;
  if not exists (select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
      where ur.user_id = '00000000-0000-0000-0000-0000000000a1' and r.code = 'seller') then
    raise exception 'FAIL: seller role not granted';
  end if;

  -- an approved seller cannot open a second application
  begin
    perform public.save_seller_application('00000000-0000-0000-0000-0000000000a1', v_draft);
    raise exception 'FAIL: approved seller edited/created an application';
  exception when check_violation then null;
  end;

  -- applicants cannot review their own application; slug de-duplication
  v_app2 := public.save_seller_application('00000000-0000-0000-0000-0000000000f1', replace(v_draft::text, 'alice2@example.test', 'fola2@example.test')::jsonb);
  insert into public.seller_application_documents (application_id, kind, storage_path, original_name, mime_type, size_bytes)
  values (v_app2, 'identity', 'f1/' || v_app2 || '/x.pdf', 'id.pdf', 'application/pdf', 1000);
  perform public.submit_seller_application('00000000-0000-0000-0000-0000000000f1');
  perform public.review_seller_application('00000000-0000-0000-0000-0000000000c1', v_app2, 'start_review');
  perform public.review_seller_application('00000000-0000-0000-0000-0000000000c1', v_app2, 'approve');
  select s.slug into v_slug2 from public.stores s join public.sellers sl on sl.id = s.seller_id
    where sl.user_id = '00000000-0000-0000-0000-0000000000f1';
  if v_slug2 <> 'alice-crafts-2' then raise exception 'FAIL: slug not de-duplicated, got %', v_slug2; end if;

  -- audit trail exists
  if (select count(*) from public.audit_logs where action like 'seller_application.%') < 6 then
    raise exception 'FAIL: expected audit rows for the workflow';
  end if;
  if (select count(*) from public.seller_application_events where application_id = v_app) < 7 then
    raise exception 'FAIL: expected a status history';
  end if;

  -- suspension needs sellers.manage and a note
  begin
    perform public.set_seller_status('00000000-0000-0000-0000-0000000000e1',
      (select id from public.sellers where user_id = '00000000-0000-0000-0000-0000000000a1'), 'suspended', 'Policy violation');
    raise exception 'FAIL: support suspended a seller';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_seller_status('00000000-0000-0000-0000-0000000000c1',
      (select id from public.sellers where user_id = '00000000-0000-0000-0000-0000000000a1'), 'suspended');
    raise exception 'FAIL: suspended without a note';
  exception when invalid_parameter_value then null;
  end;
  perform public.set_seller_status('00000000-0000-0000-0000-0000000000c1',
    (select id from public.sellers where user_id = '00000000-0000-0000-0000-0000000000a1'), 'suspended', 'Policy violation');
  if (select status from public.sellers where user_id = '00000000-0000-0000-0000-0000000000a1') <> 'suspended' then
    raise exception 'FAIL: seller not suspended';
  end if;

  reset role;
end $$;

-- 3. RLS isolation on seller tables -----------------------------------------------------
do $$
declare v_n integer;
begin
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into v_n from public.seller_applications;
  if v_n <> 1 then raise exception 'FAIL: alice sees % applications', v_n; end if;
  select count(*) into v_n from public.seller_application_documents;
  if v_n < 1 then raise exception 'FAIL: alice cannot see her own documents'; end if;
  select count(*) into v_n from public.stores;
  if v_n <> 1 then raise exception 'FAIL: alice sees % stores', v_n; end if;
  begin
    update public.seller_applications set status = 'approved';
    raise exception 'FAIL: applicant updated application status';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.sellers set status = 'active';
    raise exception 'FAIL: seller updated own seller row';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.stores set slug = 'hijack';
    raise exception 'FAIL: seller changed slug directly';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.review_seller_application('00000000-0000-0000-0000-0000000000a1', gen_random_uuid(), 'approve');
    raise exception 'FAIL: client executed review function';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.save_seller_application('00000000-0000-0000-0000-0000000000a1', '{}'::jsonb);
    raise exception 'FAIL: client executed save_seller_application directly';
  exception when insufficient_privilege then null;
  end;
  reset role;

  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into v_n from public.seller_applications;
  if v_n <> 0 then raise exception 'FAIL: bob sees % applications', v_n; end if;
  select count(*) into v_n from public.seller_application_documents;
  if v_n <> 0 then raise exception 'FAIL: bob sees seller documents'; end if;
  select count(*) into v_n from public.stores;
  if v_n <> 0 then raise exception 'FAIL: bob sees % stores directly', v_n; end if;
  reset role;

  -- staff with sellers.read (super_admin) see everything; support does not
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into v_n from public.seller_applications;
  if v_n < 2 then raise exception 'FAIL: super_admin sees % applications', v_n; end if;
  reset role;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into v_n from public.seller_applications;
  if v_n <> 0 then raise exception 'FAIL: customer_support sees % applications', v_n; end if;
  reset role;

  set local role anon;
  begin
    perform 1 from public.stores limit 1;
    raise exception 'FAIL: anon read stores';
  exception when insufficient_privilege then null;
  end;
  reset role;
end $$;

-- 4. Structure --------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity) then
    raise exception 'FAIL: a public table has RLS disabled';
  end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon') then
    raise exception 'FAIL: anon has table grants in public';
  end if;
  if to_regclass('storage.buckets') is not null then
    if (select public from storage.buckets where id = 'seller-documents') is distinct from false then
      raise exception 'FAIL: seller-documents bucket is not private';
    end if;
  end if;
end $$;

rollback;

\echo 'ALL STAGE 2 SQL TESTS PASSED (transaction rolled back)'
