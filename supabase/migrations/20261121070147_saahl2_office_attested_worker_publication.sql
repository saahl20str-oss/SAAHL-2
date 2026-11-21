-- An approved office can publish one owned directory profile after recording its
-- own attestation. Keep prior worker-link responses as separate records.
create table saahl_worker_private.office_attestations (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers(id) on delete cascade,
  declared_by uuid not null,
  declared_at timestamptz not null default now(),
  photo_allowed boolean not null,
  profile_digest text not null
);
alter table saahl_worker_private.office_attestations enable row level security;
revoke all on saahl_worker_private.office_attestations from public, anon, authenticated;
create index office_attestations_worker_idx on saahl_worker_private.office_attestations(worker_id);

create function saahl_worker_private.publish_with_office_attestation(
  p_worker uuid, p_data_confirmed boolean, p_include_photo boolean, p_confirmed_photo text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  w public.workers%rowtype;
  final_photo text;
  public_path text;
  receipt uuid;
  recorded_at timestamptz := now();
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_data_confirmed is distinct from true then
    raise exception 'Data publication attestation required' using errcode = '23514';
  end if;
  select workers.* into w from public.workers join public.offices o on o.id = workers.office_id
  where workers.id = p_worker and o.owner_id = actor for update of workers;
  if not found then raise exception 'Worker not found' using errcode = '42501'; end if;
  perform 1 from public.offices where id = w.office_id and owner_id = actor and status = 'approved' for share;
  if not found then raise exception 'Office is not approved' using errcode = '23514'; end if;

  -- Retrying a successful request cannot change its photo decision or duplicate the audit entry.
  if w.status = 'available' and w.publication_consent_at is not null then return; end if;
  if p_include_photo is true then
    if p_confirmed_photo is null or p_confirmed_photo is distinct from coalesce(w.publication_photo_draft, w.photo_url) then
      raise exception 'Photo changed after preparation' using errcode = '40001';
    end if;
    if w.publication_photo_draft is not null then
      public_path := w.office_id::text || '/workers/' || split_part(w.publication_photo_draft,'/',2);
      if not exists (
        select 1 from storage.objects source
        join storage.objects target on target.bucket_id = 'saahl-office-media' and target.name = public_path
        where source.bucket_id = 'saahl-worker-drafts' and source.name = w.publication_photo_draft
          and source.metadata->>'eTag' is not null and source.metadata->>'eTag' = target.metadata->>'eTag'
      ) then raise exception 'Approved photo could not be verified' using errcode = '23514'; end if;
      final_photo := 'https://hkfxikmpfgixrbrboxeb.supabase.co/storage/v1/object/public/saahl-office-media/' || public_path;
    elsif w.photo_url ~* '^https://' then
      final_photo := w.photo_url;
    else
      raise exception 'No eligible photo' using errcode = '23514';
    end if;
  end if;

  insert into saahl_worker_private.office_attestations(worker_id,declared_by,declared_at,photo_allowed,profile_digest)
  values(w.id,actor,recorded_at,final_photo is not null,
    encode(sha256(convert_to(saahl_worker_private.worker_snapshot(w)::text,'UTF8')),'hex'))
  returning id into receipt;

  update public.workers set status = 'available',
    publication_consent_ref = 'office-attestation:' || receipt::text,
    publication_consent_at = recorded_at, photo_url = final_photo,
    publication_photo_draft = case when final_photo is null then w.publication_photo_draft end
  where id = w.id;
end;
$$;
revoke execute on function saahl_worker_private.publish_with_office_attestation(uuid,boolean,boolean,text)
  from public, anon, authenticated;
grant usage on schema saahl_worker_private to authenticated;
grant execute on function saahl_worker_private.publish_with_office_attestation(uuid,boolean,boolean,text) to authenticated;
revoke execute on function saahl_worker_private.worker_snapshot(public.workers) from public, anon, authenticated;

create function public.saahl2_publish_with_office_attestation(
  p_worker uuid, p_data_confirmed boolean, p_include_photo boolean, p_confirmed_photo text
) returns void
language sql security invoker set search_path = '' as $$
  select saahl_worker_private.publish_with_office_attestation(p_worker,p_data_confirmed,p_include_photo,p_confirmed_photo)
$$;
revoke execute on function public.saahl2_publish_with_office_attestation(uuid,boolean,boolean,text)
  from public, anon, authenticated;
grant execute on function public.saahl2_publish_with_office_attestation(uuid,boolean,boolean,text) to authenticated;
