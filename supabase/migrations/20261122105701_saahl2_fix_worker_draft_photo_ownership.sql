-- Match the office folder against the storage object's path.
alter policy saahl_worker_draft_owner_upload on storage.objects
with check (
  bucket_id = 'saahl-worker-drafts'
  and exists (
    select 1 from public.offices o
    where o.owner_id = (select auth.uid())
      and split_part(objects.name, '/', 1) = o.id::text
  )
);

alter policy saahl_worker_draft_owner_read on storage.objects
using (
  bucket_id = 'saahl-worker-drafts'
  and exists (
    select 1 from public.offices o
    where o.owner_id = (select auth.uid())
      and split_part(objects.name, '/', 1) = o.id::text
  )
);

alter policy saahl_worker_draft_owner_remove on storage.objects
using (
  bucket_id = 'saahl-worker-drafts'
  and exists (
    select 1 from public.offices o
    where o.owner_id = (select auth.uid())
      and split_part(objects.name, '/', 1) = o.id::text
  )
);
