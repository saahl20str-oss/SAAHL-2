insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('saahl2-office-licenses', 'saahl2-office-licenses', false, 5242880,
        array['application/pdf', 'image/jpeg', 'image/png']);

create policy saahl2_license_pending_owner_upload on storage.objects
for insert to authenticated
with check (
  bucket_id = 'saahl2-office-licenses'
  and exists (
    select 1 from public.offices o
    where o.owner_id = (select auth.uid()) and o.status = 'pending'
      and storage.objects.name = o.id::text || '/license'
  )
);

create policy saahl2_license_admin_read on storage.objects
for select to authenticated
using (bucket_id = 'saahl2-office-licenses' and (select public.is_saahl_admin()));
