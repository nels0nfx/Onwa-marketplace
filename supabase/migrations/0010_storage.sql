-- ONWA 0010: Supabase Storage buckets and policies.
--   seller-documents : PRIVATE. KYC files. Owner folder = auth.uid(). Staff with sellers.read may read.
--   store-media      : PUBLIC read (logos, covers). Writes only by the owning active seller (folder = seller id).
-- Guarded so the migration is a no-op on plain PostgreSQL without the storage schema (CI shim).

do $do$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise notice 'storage schema not present; skipping bucket and policy creation';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('seller-documents', 'seller-documents', false, 5242880, array['application/pdf', 'image/jpeg', 'image/png'])
  on conflict (id) do update set public = false, file_size_limit = 5242880,
    allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png'];

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('store-media', 'store-media', true, 4194304, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do update set public = true, file_size_limit = 4194304,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

  execute 'drop policy if exists onwa_seller_docs_insert_own on storage.objects';
  execute $p$create policy onwa_seller_docs_insert_own on storage.objects for insert to authenticated
    with check (bucket_id = 'seller-documents' and (storage.foldername(name))[1] = (select auth.uid())::text)$p$;

  execute 'drop policy if exists onwa_seller_docs_select_own on storage.objects';
  execute $p$create policy onwa_seller_docs_select_own on storage.objects for select to authenticated
    using (bucket_id = 'seller-documents' and (storage.foldername(name))[1] = (select auth.uid())::text)$p$;

  execute 'drop policy if exists onwa_seller_docs_delete_own on storage.objects';
  execute $p$create policy onwa_seller_docs_delete_own on storage.objects for delete to authenticated
    using (bucket_id = 'seller-documents' and (storage.foldername(name))[1] = (select auth.uid())::text)$p$;

  execute 'drop policy if exists onwa_seller_docs_select_staff on storage.objects';
  execute $p$create policy onwa_seller_docs_select_staff on storage.objects for select to authenticated
    using (bucket_id = 'seller-documents' and (select public.has_permission('sellers.read')))$p$;

  execute 'drop policy if exists onwa_store_media_insert_owner on storage.objects';
  execute $p$create policy onwa_store_media_insert_owner on storage.objects for insert to authenticated
    with check (bucket_id = 'store-media' and exists (
      select 1 from public.sellers s
      where s.id::text = (storage.foldername(name))[1] and s.user_id = (select auth.uid()) and s.status = 'active'))$p$;

  execute 'drop policy if exists onwa_store_media_delete_owner on storage.objects';
  execute $p$create policy onwa_store_media_delete_owner on storage.objects for delete to authenticated
    using (bucket_id = 'store-media' and exists (
      select 1 from public.sellers s
      where s.id::text = (storage.foldername(name))[1] and s.user_id = (select auth.uid())))$p$;
end
$do$;
