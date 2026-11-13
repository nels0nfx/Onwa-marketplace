-- ONWA 0012: product image bucket. PUBLIC read (product pictures are public content; file names are random UUIDs).
-- Writes only by the owning active seller (folder = seller id). Skipped on plain PostgreSQL without storage.

do $do$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise notice 'storage schema not present; skipping product-media bucket and policies';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('product-media', 'product-media', true, 4194304, array['image/jpeg', 'image/png', 'image/webp'])
  on conflict (id) do update set public = true, file_size_limit = 4194304,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

  execute 'drop policy if exists onwa_product_media_insert_owner on storage.objects';
  execute $p$create policy onwa_product_media_insert_owner on storage.objects for insert to authenticated
    with check (bucket_id = 'product-media' and exists (
      select 1 from public.sellers s
      where s.id::text = (storage.foldername(name))[1] and s.user_id = (select auth.uid()) and s.status = 'active'))$p$;

  execute 'drop policy if exists onwa_product_media_delete_owner on storage.objects';
  execute $p$create policy onwa_product_media_delete_owner on storage.objects for delete to authenticated
    using (bucket_id = 'product-media' and exists (
      select 1 from public.sellers s
      where s.id::text = (storage.foldername(name))[1] and s.user_id = (select auth.uid())))$p$;
end
$do$;
