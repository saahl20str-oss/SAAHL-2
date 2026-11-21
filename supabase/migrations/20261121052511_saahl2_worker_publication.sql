-- Office directory only. Transfer-listing consent and existing records are independent.
create schema saahl_worker_private;
revoke all on schema saahl_worker_private from public, anon, authenticated;

alter table public.workers add column publication_photo_draft text;

create table saahl_worker_private.requests (
  worker_id uuid primary key references public.workers(id) on delete cascade,
  token_hash text not null unique,
  snapshot jsonb not null,
  preview_url text,
  expires_at timestamptz not null,
  answered_at timestamptz,
  data_allowed boolean,
  photo_allowed boolean
);
alter table saahl_worker_private.requests enable row level security;
revoke all on saahl_worker_private.requests from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('saahl-worker-drafts', 'saahl-worker-drafts', false, 5242880,
        array['image/jpeg','image/png','image/webp']);

create policy saahl_worker_draft_owner_read on storage.objects for select to authenticated
using (bucket_id = 'saahl-worker-drafts' and
       exists (select 1 from public.offices o where o.owner_id = (select auth.uid())
               and split_part(name, '/', 1) = o.id::text));

create policy saahl_worker_draft_owner_upload on storage.objects for insert to authenticated
with check (bucket_id = 'saahl-worker-drafts' and
            exists (select 1 from public.offices o where o.owner_id = (select auth.uid())
                    and split_part(name, '/', 1) = o.id::text));

create policy saahl_worker_draft_owner_remove on storage.objects for delete to authenticated
using (bucket_id = 'saahl-worker-drafts' and
       exists (select 1 from public.offices o where o.owner_id = (select auth.uid())
               and split_part(name, '/', 1) = o.id::text));

create function saahl_worker_private.worker_snapshot(w public.workers) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'office_id', w.office_id, 'name', w.display_name, 'number', w.worker_number,
    'nationality', w.nationality, 'age', w.age, 'religion', w.religion,
    'salary', w.salary_aed, 'experience', w.experience_years, 'countries', w.country_experience,
    'skills', w.skills, 'languages', w.languages, 'description', w.description,
    'photo', w.photo_url, 'draft_photo', w.publication_photo_draft
  )
$$;

-- As this trigger runs as the caller, only the publication RPC (or trusted
-- database administration) can issue fresh consent on the worker row.
create or replace function public.saahl2_guard_worker_publication()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.publication_photo_draft is not null and
     new.publication_photo_draft !~ ('^' || new.office_id::text || '/[a-f0-9-]{36}\.(jpg|png|webp)$') then
    raise exception 'Invalid private photo path' using errcode = '22023';
  end if;
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.publication_consent_ref := null;
      new.publication_consent_at := null;
    elsif row(new.office_id, new.display_name, new.worker_number, new.nationality, new.age,
              new.religion, new.salary_aed, new.experience_years, new.country_experience,
              new.skills, new.languages, new.description, new.photo_url, new.publication_photo_draft)
       is distinct from
          row(old.office_id, old.display_name, old.worker_number, old.nationality, old.age,
              old.religion, old.salary_aed, old.experience_years, old.country_experience,
              old.skills, old.languages, old.description, old.photo_url, old.publication_photo_draft) then
      new.publication_consent_ref := null;
      new.publication_consent_at := null;
      if new.status = 'available' then new.status := 'draft'; end if;
    else
      new.publication_consent_ref := old.publication_consent_ref;
      new.publication_consent_at := old.publication_consent_at;
    end if;
  end if;
  if new.status = 'available' and new.publication_consent_at is null and
     (tg_op = 'INSERT' or old.status is distinct from 'available') then
    raise exception 'Record worker approval before publishing' using errcode = '23514';
  end if;
  return new;
end;
$$;

create function public.saahl2_request_worker_publication(p_worker uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  w public.workers%rowtype;
  previous saahl_worker_private.requests%rowtype;
  raw_token text;
  deadline timestamptz := now() + interval '7 days';
begin
  select workers.* into w from public.workers join public.offices o on o.id = workers.office_id
  where workers.id = p_worker and o.owner_id = auth.uid() for update of workers;
  if not found then raise exception 'Worker not found' using errcode = '42501'; end if;
  if w.publication_consent_at is not null then
    raise exception 'This profile already has approval' using errcode = '22023';
  end if;
  select * into previous from saahl_worker_private.requests where worker_id = w.id;
  if previous.data_allowed is true and previous.snapshot = saahl_worker_private.worker_snapshot(w) then
    raise exception 'This profile already has approval' using errcode = '22023';
  end if;
  raw_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into saahl_worker_private.requests (worker_id, token_hash, snapshot, expires_at)
  values (w.id, encode(sha256(convert_to(raw_token,'UTF8')),'hex'), saahl_worker_private.worker_snapshot(w), deadline)
  on conflict (worker_id) do update set token_hash = excluded.token_hash, snapshot = excluded.snapshot,
    expires_at = excluded.expires_at, preview_url = null, answered_at = null, data_allowed = null, photo_allowed = null;
  return jsonb_build_object('token', raw_token);
end;
$$;

-- Bind a short-lived signed preview to the pending request after Storage signs the
-- exact draft object under the office's normal authorization.
create function public.saahl2_set_worker_publication_preview(p_worker uuid, p_token text, p_url text) returns void
language plpgsql security definer set search_path = '' as $$
declare w public.workers%rowtype;
begin
  select workers.* into w from public.workers join public.offices o on o.id = workers.office_id
  where workers.id = p_worker and o.owner_id = auth.uid() for update of workers;
  if not found then raise exception 'Worker not found' using errcode = '42501'; end if;
  if w.publication_photo_draft is null or p_url is null or length(p_url) > 2048 or
     not starts_with(p_url,'https://hkfxikmpfgixrbrboxeb.supabase.co/storage/v1/object/sign/saahl-worker-drafts/'
       || w.publication_photo_draft || '?token=') then
    raise exception 'Invalid photo preview' using errcode = '22023';
  end if;
  update saahl_worker_private.requests set preview_url = p_url
  where worker_id = w.id and token_hash = encode(sha256(convert_to(p_token,'UTF8')),'hex') and answered_at is null and
        expires_at > now() and snapshot = saahl_worker_private.worker_snapshot(w);
  if not found then raise exception 'Request is no longer current' using errcode = '22023'; end if;
end;
$$;

create function public.saahl2_worker_publication_link(p_token text, p_approve boolean default null,
  p_photo boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r saahl_worker_private.requests%rowtype;
  w public.workers%rowtype;
  office_name text;
  preview text;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then return null; end if;
  select * into r from saahl_worker_private.requests where token_hash = encode(sha256(convert_to(p_token,'UTF8')),'hex');
  if not found or r.expires_at <= now() then return null; end if;
  select * into w from public.workers where id = r.worker_id for update;
  if not found then return null; end if;
  -- All state-changing RPCs lock the worker first, so a new link or an edit
  -- cannot race a response from a previous link.
  select * into r from saahl_worker_private.requests where worker_id = w.id and token_hash = encode(sha256(convert_to(p_token,'UTF8')),'hex');
  if not found or r.expires_at <= now() or r.snapshot <> saahl_worker_private.worker_snapshot(w) then return null; end if;
  if r.answered_at is not null then
    return jsonb_build_object('status', case when r.data_allowed then 'approved' else 'declined' end);
  end if;
  preview := case when w.publication_photo_draft is not null then r.preview_url
                  when w.photo_url ~* '^https://' then w.photo_url end;
  if w.publication_photo_draft is not null and preview is null then return null; end if;
  if p_approve is not null then
    update saahl_worker_private.requests set answered_at = now(), data_allowed = p_approve,
      photo_allowed = p_approve and coalesce(p_photo,false) and preview is not null,
      preview_url = null
    where worker_id = w.id;
    return jsonb_build_object('status', case when p_approve then 'approved' else 'declined' end);
  end if;
  select name into office_name from public.offices where id = w.office_id;
  return jsonb_build_object('status','pending','office',office_name,'photo_url',preview,
    'profile',r.snapshot - array['office_id','photo','draft_photo']);
end;
$$;

create function public.saahl2_office_publication_states(p_office uuid)
returns table(worker_id uuid, state text, photo_allowed boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.offices where id = p_office and owner_id = auth.uid()) then
    raise exception 'Office not found' using errcode = '42501';
  end if;
  return query select w.id,
    case when w.publication_consent_at is not null then 'documented'
         when r.worker_id is null or r.snapshot <> saahl_worker_private.worker_snapshot(w) then 'new'
         when r.data_allowed is true then 'approved'
         when r.data_allowed is false then 'declined'
         when r.expires_at <= now() then 'expired'
         else 'pending' end,
    coalesce(r.data_allowed and r.photo_allowed and r.snapshot = saahl_worker_private.worker_snapshot(w),false)
  from public.workers w left join saahl_worker_private.requests r on r.worker_id = w.id
  where w.office_id = p_office;
end;
$$;

create function public.saahl2_publish_office_worker(p_worker uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  w public.workers%rowtype;
  r saahl_worker_private.requests%rowtype;
  final_photo text;
  public_path text;
begin
  select workers.* into w
  from public.workers join public.offices o on o.id = workers.office_id
  where workers.id = p_worker and o.owner_id = auth.uid() for update of workers;
  if not found then raise exception 'Worker not found' using errcode = '42501'; end if;
  if not exists (select 1 from public.offices where id = w.office_id and status = 'approved') then raise exception 'Office is not approved' using errcode = '23514'; end if;
  if w.publication_consent_at is not null then
    update public.workers set status = 'available' where id = w.id;
    return;
  end if;
  select * into r from saahl_worker_private.requests where worker_id = w.id;
  if not found or r.data_allowed is distinct from true or r.snapshot <> saahl_worker_private.worker_snapshot(w) then
    raise exception 'Current worker approval required' using errcode = '23514';
  end if;
  if r.photo_allowed then
    final_photo := w.photo_url;
    if w.publication_photo_draft is not null then
      public_path := w.office_id::text || '/workers/' || split_part(w.publication_photo_draft,'/',2);
      if not exists (
        select 1 from storage.objects source
        join storage.objects target on target.bucket_id = 'saahl-office-media' and target.name = public_path
        where source.bucket_id = 'saahl-worker-drafts' and source.name = w.publication_photo_draft
          and source.metadata->>'eTag' is not null and source.metadata->>'eTag' = target.metadata->>'eTag'
      ) then raise exception 'Approved photo could not be verified' using errcode = '23514'; end if;
      final_photo := 'https://hkfxikmpfgixrbrboxeb.supabase.co/storage/v1/object/public/saahl-office-media/' || public_path;
    end if;
  end if;
  update public.workers set status = 'available', publication_consent_ref = 'worker-link:' || left(r.token_hash,12),
    publication_consent_at = r.answered_at, photo_url = final_photo, publication_photo_draft = null where id = w.id;
end;
$$;

revoke execute on function public.saahl2_request_worker_publication(uuid),
  public.saahl2_set_worker_publication_preview(uuid,text,text),
  public.saahl2_worker_publication_link(text,boolean,boolean),
  public.saahl2_office_publication_states(uuid), public.saahl2_publish_office_worker(uuid)
from public, anon, authenticated;
grant execute on function public.saahl2_request_worker_publication(uuid),
  public.saahl2_set_worker_publication_preview(uuid,text,text),
  public.saahl2_office_publication_states(uuid), public.saahl2_publish_office_worker(uuid) to authenticated;
grant execute on function public.saahl2_worker_publication_link(text,boolean,boolean) to anon, authenticated;
