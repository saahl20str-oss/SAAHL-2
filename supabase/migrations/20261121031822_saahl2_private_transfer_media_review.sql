begin;
-- Legacy objects remain private and are reviewable through expiring links by administrators.
create policy saahl2_transfer_media_admin_read on storage.objects
for select to authenticated
using (bucket_id='saahl-kafala-photos' and (select public.is_saahl_admin()));
commit;
