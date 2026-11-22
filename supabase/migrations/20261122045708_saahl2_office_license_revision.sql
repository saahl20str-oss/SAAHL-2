create table saahl_worker_private.office_license_revisions (
  office_id uuid primary key references public.offices(id) on delete cascade,
  attachment_path text not null,
  submitted_at timestamptz not null default now()
);
alter table saahl_worker_private.office_license_revisions enable row level security;
revoke all on saahl_worker_private.office_license_revisions from public, anon, authenticated;

alter policy saahl2_license_pending_owner_upload on storage.objects
with check (
  bucket_id = 'saahl2-office-licenses' and exists (
    select 1 from public.offices o where o.owner_id = (select auth.uid())
      and o.status in ('pending','approved')
      and (storage.objects.name = o.id::text || '/license'
        or storage.objects.name ~ ('^' || o.id::text || '/revision-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
  )
);

create or replace function saahl_worker_private.office_license_review(p_office uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  is_admin boolean;
  office_owner uuid;
  contact_email text;
  revision saahl_worker_private.office_license_revisions%rowtype;
  path text;
begin
  if actor is null then raise insufficient_privilege; end if;
  is_admin := coalesce(public.is_saahl_admin(),false);
  select owner_id into office_owner from public.offices where id=p_office;
  if not found or (not is_admin and office_owner is distinct from actor) then raise insufficient_privilege; end if;
  if is_admin then
    select email into contact_email from auth.users where id=office_owner and email_confirmed_at is not null;
  end if;
  select * into revision from saahl_worker_private.office_license_revisions where office_id=p_office;
  select f.name into path from storage.objects f where f.bucket_id='saahl2-office-licenses'
    and f.name=coalesce(revision.attachment_path,p_office::text||'/license');
  return jsonb_build_object('has_attachment',path is not null,'contact_email',contact_email,
    'attachment_path',case when is_admin then path end,'submitted_at',revision.submitted_at);
end;
$$;

create function saahl_worker_private.submit_office_license_revision(
  p_office uuid,p_path text,p_number text,p_issuer text
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  office_row public.offices%rowtype;
  active_path text;
begin
  if auth.uid() is null then raise insufficient_privilege; end if;
  select * into office_row from public.offices where id=p_office and owner_id=auth.uid() for update;
  if not found or office_row.status not in ('pending','approved') then raise insufficient_privilege; end if;
  if p_number is null or length(btrim(p_number)) not between 1 and 120
     or p_issuer is null or length(btrim(p_issuer)) not between 4 and 120 then
    raise exception 'Invalid license details' using errcode='22023';
  end if;
  if p_path is null or p_path !~ ('^'||p_office::text||'/revision-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
     or not exists(select 1 from storage.objects where bucket_id='saahl2-office-licenses' and name=p_path) then
    raise exception 'License attachment not found' using errcode='22023';
  end if;
  select attachment_path into active_path from saahl_worker_private.office_license_revisions where office_id=p_office;
  if active_path=p_path and office_row.license_number=btrim(p_number) and office_row.declared_license_issuer=btrim(p_issuer) then return; end if;
  insert into saahl_worker_private.office_license_revisions(office_id,attachment_path,submitted_at)
    values(p_office,p_path,now())
    on conflict(office_id) do update set attachment_path=excluded.attachment_path, submitted_at=excluded.submitted_at;
  update public.offices set license_number=btrim(p_number),declared_license_issuer=btrim(p_issuer),status='pending',
    verified_license_at=null,verified_license_issuer=null,verified_license_expires=null where id=p_office;
end;
$$;

create function public.saahl2_submit_office_license_revision(p_office uuid,p_path text,p_number text,p_issuer text)
returns void language sql security invoker set search_path = '' as $$
  select saahl_worker_private.submit_office_license_revision(p_office,p_path,p_number,p_issuer)
$$;

-- Verify the exact attachment the reviewer opened. The lock also serializes
-- verification with replacement, which clears the old approval.
create function saahl_worker_private.verify_office_license_revision(p_id uuid,p_issuer text,p_expires date,p_expected_path text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  active_path text;
begin
  if auth.uid() is null or public.is_saahl_admin() is distinct from true then raise insufficient_privilege; end if;
  perform 1 from public.offices where id=p_id for update;
  select attachment_path into active_path from saahl_worker_private.office_license_revisions where office_id=p_id;
  if active_path is distinct from p_expected_path then
    raise exception 'License revision changed' using errcode='40001';
  end if;
  if p_issuer is null or length(btrim(p_issuer)) not between 4 and 120
     or p_expires is null or p_expires < (now() at time zone 'Asia/Dubai')::date then
    raise exception 'Issuing authority and a valid expiry required' using errcode='22023';
  end if;
  update public.offices set verified_license_issuer=btrim(p_issuer),verified_license_at=now(),verified_license_expires=p_expires
    where id=p_id and nullif(btrim(license_number),'') is not null;
  if not found then raise exception 'Office license number required'; end if;
end;
$$;

create or replace function public.saahl2_verify_office(p_id uuid,p_issuer text,p_expires date)
returns void language sql security invoker set search_path = '' as $$
  select saahl_worker_private.verify_office_license_revision(p_id,p_issuer,p_expires,null)
$$;
create function public.saahl2_verify_office_revision(p_id uuid,p_issuer text,p_expires date,p_expected_path text)
returns void language sql security invoker set search_path = '' as $$
  select saahl_worker_private.verify_office_license_revision(p_id,p_issuer,p_expires,p_expected_path)
$$;

revoke all on function saahl_worker_private.submit_office_license_revision(uuid,text,text,text),
  public.saahl2_submit_office_license_revision(uuid,text,text,text),
  saahl_worker_private.verify_office_license_revision(uuid,text,date,text),
  public.saahl2_verify_office(uuid,text,date), public.saahl2_verify_office_revision(uuid,text,date,text)
  from public, anon, authenticated;
grant execute on function saahl_worker_private.submit_office_license_revision(uuid,text,text,text),
  public.saahl2_submit_office_license_revision(uuid,text,text,text),
  saahl_worker_private.verify_office_license_revision(uuid,text,date,text),
  public.saahl2_verify_office(uuid,text,date), public.saahl2_verify_office_revision(uuid,text,date,text)
  to authenticated;
