begin;

-- The existing admin role is assigned by trusted database operators only.
create function public.saahl2_guard_profile_role()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user in ('anon','authenticated') then
    if tg_op = 'INSERT' then
      if new.role is distinct from 'customer' then raise insufficient_privilege; end if;
    elsif new.role is distinct from old.role then
      raise insufficient_privilege;
    end if;
  end if;
  return new;
end;
$$;
create trigger saahl2_guard_profile_role before insert or update of role on public.profiles
for each row execute function public.saahl2_guard_profile_role();
revoke execute on function public.saahl2_guard_profile_role() from public,anon,authenticated;

do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=any(array[
      'cancel_saahl_booking','respond_saahl_booking','review_saahl_office','review_saahl_transfer',
      'saahl_new_user_profile','update_own_saahl_office','update_own_saahl_office_profile'
    ])
  loop execute format('revoke execute on function %s from public, anon', f); end loop;
end;
$$;

-- Keep review material out of the public data API, including for signed-in visitors.
alter table public.kafala_ads
  add column launch_declarations_at timestamptz,
  add column launch_verified_at timestamptz,
  add column launch_verified_by uuid,
  add column launch_evidence_ref text;

revoke select on public.kafala_ads from public,anon,authenticated;
revoke select (id,worker_name,nationality,age,profession,experience_years,current_status,emirate,skills,
  reason,contact_phone,sponsor_display_name,ad_days,starts_at,ends_at,is_active,created_at,
  review_status,worker_photo_url,monthly_salary,religion) on public.kafala_ads from public,anon,authenticated;

update storage.buckets set public=false where id='saahl-kafala-photos';
create policy saahl2_no_guest_transfer_upload on storage.objects as restrictive
for insert to anon,authenticated with check (bucket_id <> 'saahl-kafala-photos');

create function public.saahl2_public_transfers()
returns table(id uuid, profession text, emirate text, age integer, experience_years integer,
  monthly_salary numeric, ends_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select k.id,k.profession,k.emirate,k.age::integer,k.experience_years::integer,
    k.monthly_salary::numeric,k.ends_at
  from public.kafala_ads k
  where k.is_active and k.review_status='approved' and k.ends_at>now()
    and k.launch_verified_at is not null and k.age between 18 and 60
  order by k.created_at desc
  limit 200;
$$;
revoke execute on function public.saahl2_public_transfers() from public;
grant execute on function public.saahl2_public_transfers() to anon,authenticated;

create function public.saahl2_admin_transfers()
returns setof public.kafala_ads language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_saahl_admin() then raise insufficient_privilege; end if;
  return query select * from public.kafala_ads order by created_at desc;
end;
$$;
revoke execute on function public.saahl2_admin_transfers() from public,anon;
grant execute on function public.saahl2_admin_transfers() to authenticated;

create function public.saahl2_submit_transfer(p_request uuid,p_number text,p_pin text,p_days integer,
  p_fields jsonb,p_declarations jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare result text;
begin
  if not coalesce(p_declarations @> '{"version":"2026-11-21","worker_consent":true,"current_sponsor":true,"accuracy":true,"official_procedure":true,"privacy":true}'::jsonb,false) then
    raise exception 'Required declarations were not accepted' using errcode='22023';
  end if;
  result := public.kafala_submit_numbered(p_request,p_number,p_pin,p_days,p_fields);
  update public.kafala_ads a set launch_declarations_at=now()
    from kafala_private.owner_access o
    where o.creation_key=p_request and a.id=o.ad_id and a.launch_declarations_at is null;
  return result;
end;
$$;
revoke execute on function public.kafala_submit_numbered(uuid,text,text,integer,jsonb),
  public.kafala_submit_protected(uuid,text,integer,jsonb) from public,anon,authenticated;
revoke execute on function public.saahl2_submit_transfer(uuid,text,text,integer,jsonb,jsonb) from public;
grant execute on function public.saahl2_submit_transfer(uuid,text,text,integer,jsonb,jsonb) to anon,authenticated;

create function public.saahl2_guard_transfer_publication()
returns trigger language plpgsql set search_path = '' as $$
begin
  if row(new.worker_name,new.age,new.profession,new.emirate,new.contact_phone,new.sponsor_display_name,
         new.worker_photo_url,new.nationality,new.experience_years,new.monthly_salary,new.reason,new.skills,new.ad_days,new.current_status)
     is distinct from row(old.worker_name,old.age,old.profession,old.emirate,old.contact_phone,old.sponsor_display_name,
         old.worker_photo_url,old.nationality,old.experience_years,old.monthly_salary,old.reason,old.skills,old.ad_days,old.current_status)
  then
    new.launch_verified_at := null;
    new.launch_verified_by := null;
    new.launch_evidence_ref := null;
    if old.launch_verified_at is not null then new.is_active := false; end if;
  end if;
  if new.is_active and new.launch_verified_at is null
    and (not old.is_active or new.starts_at is distinct from old.starts_at
      or new.ends_at is distinct from old.ends_at or new.review_status is distinct from old.review_status)
  then raise exception 'Sponsor and worker consent verification required' using errcode='23514'; end if;
  return new;
end;
$$;
create trigger saahl2_guard_transfer_publication before update on public.kafala_ads
for each row execute function public.saahl2_guard_transfer_publication();
revoke execute on function public.saahl2_guard_transfer_publication() from public,anon,authenticated;

create function public.saahl2_verify_transfer(p_id uuid,p_reference text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_saahl_admin() then raise insufficient_privilege; end if;
  if p_reference is null or char_length(btrim(p_reference)) not between 4 and 80 then
    raise exception 'An internal verification reference is required' using errcode='22023';
  end if;
  update public.kafala_ads set launch_verified_at=now(),launch_verified_by=auth.uid(),
    launch_evidence_ref=btrim(p_reference)
  where id=p_id and age between 18 and 60;
  if not found then raise exception 'Transfer not eligible for verification'; end if;
end;
$$;
revoke execute on function public.saahl2_verify_transfer(uuid,text) from public,anon;
grant execute on function public.saahl2_verify_transfer(uuid,text) to authenticated;

alter table public.offices add column declared_license_issuer text, add column legal_agreement jsonb, add column legal_agreement_at timestamptz,
  add column verified_license_issuer text, add column verified_license_at timestamptz, add column verified_license_expires date;
create function public.saahl2_guard_office_agreement()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op='INSERT' then
    if not coalesce(new.legal_agreement @> '{"version":"2026-11-21","license":true,"updates":true,"consent":true,"verification":true,"responsibility":true,"fees":true}'::jsonb,false) then
      raise exception 'Required office agreement was not accepted' using errcode='22023';
    end if;
    if new.declared_license_issuer is null or char_length(btrim(new.declared_license_issuer)) not between 4 and 120 then
      raise exception 'Issuing authority required' using errcode='22023';
    end if;
    new.legal_agreement_at := now();
    new.verified_license_issuer := null;
    new.verified_license_at := null;
    new.verified_license_expires := null;
  elsif row(new.name,new.license_number,new.emirate,new.phone,new.owner_id)
    is distinct from row(old.name,old.license_number,old.emirate,old.phone,old.owner_id)
  then
    new.verified_license_issuer := null;
    new.verified_license_at := null;
    new.verified_license_expires := null;
  end if;
  if new.verified_license_at is not null and (tg_op='INSERT' or new.verified_license_at is distinct from old.verified_license_at)
    and not public.is_saahl_admin() then raise insufficient_privilege; end if;
  if tg_op='UPDATE' and new.status='approved' and old.status is distinct from new.status
    and (new.verified_license_at is null or new.verified_license_expires is null or new.verified_license_expires < (now() at time zone 'Asia/Dubai')::date)
  then raise exception 'Official license check required' using errcode='23514'; end if;
  return new;
end;
$$;
create trigger saahl2_guard_office_agreement before insert or update on public.offices
for each row execute function public.saahl2_guard_office_agreement();
revoke execute on function public.saahl2_guard_office_agreement() from public,anon,authenticated;

create function public.saahl2_verify_office(p_id uuid,p_issuer text,p_expires date)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_saahl_admin() then raise insufficient_privilege; end if;
  if p_issuer is null or char_length(btrim(p_issuer)) not between 4 and 120
    or p_expires is null or p_expires < (now() at time zone 'Asia/Dubai')::date then
    raise exception 'Issuing authority required' using errcode='22023';
  end if;
  update public.offices set verified_license_issuer=btrim(p_issuer),verified_license_at=now(),verified_license_expires=p_expires
    where id=p_id and nullif(btrim(license_number),'') is not null;
  if not found then raise exception 'Office license number required'; end if;
end;
$$;
revoke execute on function public.saahl2_verify_office(uuid,text,date) from public,anon;
grant execute on function public.saahl2_verify_office(uuid,text,date) to authenticated;

-- Anonymous visitors can submit privacy, security, advertising and contact requests.
-- Their contact information is available only to administrators.
create table public.saahl2_support_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('privacy','security','complaint','transfer_contact','transfer_report')),
  requester_email text not null,
  message text not null,
  ad_id uuid references public.kafala_ads(id) on delete set null,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
alter table public.saahl2_support_requests enable row level security;
revoke all on public.saahl2_support_requests from public,anon,authenticated;
grant select, update(closed_at) on public.saahl2_support_requests to authenticated;
create policy saahl2_support_admin_read on public.saahl2_support_requests
 for select to authenticated using ((select public.is_saahl_admin()));
create policy saahl2_support_admin_close on public.saahl2_support_requests
 for update to authenticated using ((select public.is_saahl_admin())) with check ((select public.is_saahl_admin()));
create index saahl2_support_email_created_idx on public.saahl2_support_requests(requester_email,created_at);
create index saahl2_support_created_idx on public.saahl2_support_requests(created_at);

create function public.saahl2_send_request(p_kind text,p_email text,p_message text,p_ad uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare email text := lower(btrim(p_email)); receipt uuid;
begin
  if p_kind is null or p_kind not in ('privacy','security','complaint','transfer_contact','transfer_report')
    or email is null or length(email)>254 or email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    or p_message is null or char_length(btrim(p_message)) not between 10 and 1500 then
    raise exception 'Invalid request' using errcode='22023';
  end if;
  if p_kind in ('transfer_contact','transfer_report') and not exists
    (select 1 from public.saahl2_public_transfers() a where a.id=p_ad) then
    raise exception 'Transfer is unavailable' using errcode='22023';
  end if;
  if p_kind not in ('transfer_contact','transfer_report') then p_ad := null; end if;
  perform pg_advisory_xact_lock(hashtextextended('saahl2-support:'||email,0));
  if (select count(*) from public.saahl2_support_requests where requester_email=email
      and created_at>now()-interval '1 hour') >= 4 then
    raise exception 'Too many requests' using errcode='P4290';
  end if;
  insert into public.saahl2_support_requests(kind,requester_email,message,ad_id)
  values(p_kind,email,btrim(p_message),p_ad) returning id into receipt;
  return receipt;
end;
$$;
revoke execute on function public.saahl2_send_request(text,text,text,uuid) from public;
grant execute on function public.saahl2_send_request(text,text,text,uuid) to anon,authenticated;

-- A worker's own separate authorization must be documented before directory publication.
alter table public.workers add column publication_consent_ref text, add column publication_consent_at timestamptz;
create function public.saahl2_guard_worker_publication()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.publication_consent_ref is not null
     and char_length(btrim(new.publication_consent_ref)) not between 4 and 80 then
    raise exception 'Invalid consent reference' using errcode='22023';
  end if;
  if tg_op='INSERT' then
    new.publication_consent_at := case when new.publication_consent_ref is not null then now() end;
  elsif new.publication_consent_ref is distinct from old.publication_consent_ref then
    new.publication_consent_at := case when new.publication_consent_ref is not null then now() end;
  else
    new.publication_consent_at := old.publication_consent_at;
    if new.photo_url is distinct from old.photo_url and new.photo_url is not null then
      raise exception 'Record a separate consent reference for the new photo' using errcode='22023';
    end if;
  end if;
  if new.status='available' and new.publication_consent_at is null then
    raise exception 'Document worker consent before publication' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger saahl2_guard_worker_publication before insert or update on public.workers
for each row execute function public.saahl2_guard_worker_publication();
revoke execute on function public.saahl2_guard_worker_publication() from public,anon,authenticated;
create policy saahl2_documented_workers_only on public.workers as restrictive
 for select to anon,authenticated using (
   publication_consent_at is not null or public.is_saahl_admin() or public.owns_saahl_office(office_id)
 );
-- Consent references belong in the review record, not the public directory.
-- Store only an internal non-personal code here; proof must not be uploaded to public storage.

-- Keep the public banner for directory offices and prevent it from bypassing transfer review.
create policy saahl2_banner_office_insert on public.strip_ads as restrictive
 for insert to anon,authenticated with check (
   advertiser_type='office' and owner_id=(select auth.uid()) and exists (
     select 1 from public.offices o where o.id=strip_ads.office_id and o.owner_id=(select auth.uid())
       and o.status='approved' and o.phone=strip_ads.phone
       and coalesce(nullif(o.whatsapp,''),o.phone)=strip_ads.whatsapp
   ) and (worker_id is null or exists (
     select 1 from public.workers w where w.id=strip_ads.worker_id and w.office_id=strip_ads.office_id
       and w.status='available' and w.publication_consent_at is not null
   ))
 );
create policy saahl2_banner_office_read on public.strip_ads as restrictive
 for select to anon,authenticated using (advertiser_type='office' or owner_id=(select auth.uid()) or public.is_saahl_admin());

revoke insert on public.bookings from public,anon,authenticated;

notify pgrst, 'reload schema';
commit;
