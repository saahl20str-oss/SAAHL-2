-- A directory withdrawal also applies to linked announcements, including older
-- announcements that carry the worker reference in the details.
create function saahl_worker_private.strip_worker_photo(p_details text, p_photo text)
returns text language sql immutable set search_path = '' as $$
  select regexp_replace(
    case when nullif(p_photo, '') is null then p_details else replace(p_details, p_photo, '') end,
    '(^|[[:space:]]*[|][[:space:]]*)صورة العاملة[[:space:]]*:[^|]*', '', 'g'
  )
$$;
revoke execute on function saahl_worker_private.strip_worker_photo(text,text) from public, anon, authenticated;

create function public.saahl2_withdraw_worker_publication(p_worker uuid, p_full boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  w public.workers%rowtype;
  office_owner uuid;
begin
  if auth.uid() is null or p_full is null then
    raise exception 'Authentication and withdrawal scope required' using errcode = '42501';
  end if;
  select workers.* into w
  from public.workers join public.offices o on o.id = workers.office_id
  where workers.id = p_worker and o.owner_id = auth.uid()
  for update of workers;
  if not found then raise exception 'Worker not found' using errcode = '42501'; end if;
  select owner_id into office_owner from public.offices where id = w.office_id;

  update public.workers
  set photo_url = null, publication_photo_draft = null,
      status = case when p_full then 'draft' else status end,
      publication_consent_at = case when p_full then null else publication_consent_at end,
      publication_consent_ref = case when p_full then null else publication_consent_ref end
  where id = w.id;

  -- Close prior consent links so they cannot restore a withdrawn permission.
  update saahl_worker_private.requests
  set expires_at = least(expires_at, now()), preview_url = null
  where worker_id = w.id;

  update public.strip_ads a
  set status = case when p_full and a.status in ('pending','approved','active')
                    then 'rejected' else a.status end,
      worker_photo_url = null,
      ad_details = saahl_worker_private.strip_worker_photo(
        saahl_worker_private.strip_worker_photo(a.ad_details, a.worker_photo_url), w.photo_url)
  where a.worker_id = w.id or (
    a.worker_id is null and a.advertiser_type = 'office'
    and (a.office_id = w.office_id or a.owner_id = office_owner)
    and substring(lower(a.ad_details) from 'worker=([0-9a-f-]{36})') = w.id::text
  );
end;
$$;
revoke execute on function public.saahl2_withdraw_worker_publication(uuid,boolean) from public, anon, authenticated;
grant execute on function public.saahl2_withdraw_worker_publication(uuid,boolean) to authenticated;

-- Serialize submitting an announcement with withdrawal. Use the current photo
-- decision when a form was opened before a photo-only withdrawal.
create function public.saahl2_guard_strip_worker_consent()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  w public.workers%rowtype;
begin
  if new.worker_id is null then return new; end if;
  select * into w from public.workers
  where id = new.worker_id and office_id = new.office_id for share;
  if not found or w.status <> 'available' or w.publication_consent_at is null then
    raise exception 'Worker publication consent is no longer current' using errcode = '23514';
  end if;
  if new.worker_photo_url is distinct from w.photo_url then
    new.ad_details := saahl_worker_private.strip_worker_photo(new.ad_details, new.worker_photo_url);
    new.worker_photo_url := null;
  end if;
  return new;
end;
$$;
revoke execute on function public.saahl2_guard_strip_worker_consent() from public, anon, authenticated;
create trigger saahl2_guard_strip_worker_consent before insert on public.strip_ads
for each row execute function public.saahl2_guard_strip_worker_consent();
