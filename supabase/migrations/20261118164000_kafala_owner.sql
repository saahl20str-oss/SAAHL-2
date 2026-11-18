begin;

create schema if not exists kafala_private;
revoke all on schema kafala_private from public, anon, authenticated;

create table kafala_private.owner_access (
  ad_id uuid primary key references public.kafala_ads(id) on delete cascade,
  request_number text unique not null,
  creation_key uuid unique not null,
  pin_hash text not null,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  draft jsonb,
  revision uuid,
  draft_status text check (draft_status in ('pending','rejected'))
);
alter table kafala_private.owner_access enable row level security;
revoke all on kafala_private.owner_access from public, anon, authenticated;

create function kafala_private.fields(p_ad public.kafala_ads)
returns jsonb language sql immutable set search_path = '' as $$
  select to_jsonb(p_ad) - array['id','tracking_token','is_active','review_status','payment_status',
    'stripe_session_id','ad_price','created_at','starts_at','ends_at','ad_days'];
$$;

create function kafala_private.validated(p_fields jsonb)
returns public.kafala_ads language plpgsql set search_path = '' as $$
declare
  v public.kafala_ads;
begin
  if jsonb_typeof(p_fields) is distinct from 'object' or octet_length(p_fields::text) > 750000 then
    raise exception 'Invalid ad';
  end if;
  v := jsonb_populate_record(null::public.kafala_ads, p_fields);
  if nullif(btrim(v.worker_name),'') is null or char_length(v.worker_name) > 100
    or nullif(btrim(v.nationality),'') is null or char_length(v.nationality) > 100
    or nullif(btrim(v.profession),'') is null or char_length(v.profession) > 100
    or nullif(btrim(v.current_status),'') is null or char_length(v.current_status) > 100
    or nullif(btrim(v.reason),'') is null or char_length(v.reason) > 1500
    or v.contact_phone is null or v.contact_phone !~ '^[+0-9 ()-]{7,28}$'
    or char_length(regexp_replace(v.contact_phone,'[^0-9]','','g')) not between 7 and 15
    or v.age is null or v.age not between 18 and 60
    or v.experience_years not between 0 and 60
    or v.monthly_salary not between 0 and 100000
    or char_length(v.religion) > 100 or char_length(v.emirate) > 100
    or char_length(v.sponsor_display_name) > 100
    or cardinality(v.skills) > 30
    or exists (select 1 from unnest(v.skills) s where char_length(s) > 100)
    or (v.worker_photo_url is not null and (
      char_length(v.worker_photo_url) > 700000
      or v.worker_photo_url !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$'
    ))
  then raise exception 'Invalid ad'; end if;
  return v;
end;
$$;

create function kafala_private.apply_fields(p_id uuid, v public.kafala_ads)
returns void language sql set search_path = '' as $$
  update public.kafala_ads set
    worker_name=v.worker_name,nationality=v.nationality,age=v.age,profession=v.profession,
    experience_years=v.experience_years,monthly_salary=v.monthly_salary,religion=v.religion,
    current_status=v.current_status,emirate=v.emirate,skills=v.skills,reason=v.reason,
    contact_phone=v.contact_phone,sponsor_display_name=v.sponsor_display_name,worker_photo_url=v.worker_photo_url
  where id=p_id;
$$;

create function public.kafala_submit_protected(p_request uuid,p_pin text,p_days integer,p_fields jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v public.kafala_ads;
  v_id uuid := gen_random_uuid();
  v_number text := upper(left(replace(p_request::text,'-',''),16));
begin
  if p_request is null or p_pin is null or p_pin !~ '^[0-9]{6}$'
    or p_days is null or p_days not between 1 and 90 then raise exception 'Invalid request'; end if;
  v := kafala_private.validated(p_fields);
  perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
  if exists (select 1 from kafala_private.owner_access where creation_key=p_request) then return v_number; end if;
  insert into public.kafala_ads(id,worker_name,ad_days,ad_price)
    values(v_id,v.worker_name,p_days,p_days*30);
  perform kafala_private.apply_fields(v_id,v);
  insert into kafala_private.owner_access(ad_id,request_number,creation_key,pin_hash)
    values(v_id,v_number,p_request,extensions.crypt(p_pin,extensions.gen_salt('bf',10)));
  return v_number;
end;
$$;

create function public.kafala_manage(p_number text,p_pin text,p_action text,p_fields jsonb default null,
  p_new_pin text default null,p_revision uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o kafala_private.owner_access;
  a public.kafala_ads;
  v public.kafala_ads;
  v_fields jsonb;
begin
  if p_number is null or p_number !~ '^[0-9A-F]{16}$' or p_pin is null or p_pin !~ '^[0-9]{6}$' then
    return jsonb_build_object('error','invalid');
  end if;
  select * into o from kafala_private.owner_access where request_number=p_number for update;
  if not found then return jsonb_build_object('error','invalid'); end if;
  if o.locked_until > now() then return jsonb_build_object('error','locked'); end if;
  if extensions.crypt(p_pin,o.pin_hash) <> o.pin_hash then
    update kafala_private.owner_access
      set failed_attempts=case when o.locked_until is null then o.failed_attempts+1 else 1 end,
          locked_until=case when o.locked_until is null and o.failed_attempts>=4
                            then now()+interval '15 minutes' end
      where ad_id=o.ad_id;
    return jsonb_build_object('error',case when o.locked_until is null and o.failed_attempts>=4 then 'locked' else 'invalid' end);
  end if;
  if o.failed_attempts<>0 or o.locked_until is not null then
    update kafala_private.owner_access set failed_attempts=0,locked_until=null where ad_id=o.ad_id;
  end if;
  select * into a from public.kafala_ads where id=o.ad_id;
  v_fields := coalesce(o.draft,kafala_private.fields(a));
  if p_action='edit' then
    if o.revision is distinct from p_revision then return jsonb_build_object('error','changed'); end if;
    if not (p_fields ? 'worker_photo_url') then
      p_fields := p_fields || jsonb_build_object('worker_photo_url',v_fields->'worker_photo_url');
    end if;
    v := kafala_private.validated(p_fields);
    v_fields := kafala_private.fields(v);
    o.revision := gen_random_uuid();
    o.draft_status := 'pending';
    update kafala_private.owner_access set draft=v_fields,revision=o.revision,draft_status='pending' where ad_id=o.ad_id;
  elsif p_action='change_pin' then
    if p_new_pin is null or p_new_pin !~ '^[0-9]{6}$' then return jsonb_build_object('error','invalid_pin'); end if;
    update kafala_private.owner_access set pin_hash=extensions.crypt(p_new_pin,extensions.gen_salt('bf',10))
      where ad_id=o.ad_id;
  elsif p_action is distinct from 'open' then
    return jsonb_build_object('error','invalid');
  end if;
  return jsonb_build_object('fields',v_fields,'status',a.review_status,'active',a.is_active,
    'ends_at',a.ends_at,'draft_status',o.draft_status,'revision',o.revision);
end;
$$;

create function public.kafala_pending_edits()
returns table(ad_id uuid,revision uuid,draft jsonb)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_saahl_admin() then raise exception 'Unauthorized'; end if;
  return query select o.ad_id,o.revision,o.draft from kafala_private.owner_access o where o.draft_status='pending';
end;
$$;

create or replace function public.review_kafala_ad(p_id uuid,p_action text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  o kafala_private.owner_access;
begin
  if not public.is_saahl_admin() then raise exception 'Unauthorized'; end if;
  select * into o from kafala_private.owner_access where ad_id=p_id for update;
  if p_action in ('approve','reject') and o.draft_status='pending' then raise exception 'Review the pending edit first'; end if;
  if p_action='approve' then
    update public.kafala_ads set review_status='approved',is_active=true,starts_at=now(),
      ends_at=now()+make_interval(days=>greatest(1,ad_days)) where id=p_id and review_status in ('pending_review','rejected');
  elsif p_action='reject' then
    update public.kafala_ads set review_status='rejected',is_active=false where id=p_id;
  elsif p_action='stop' then
    update public.kafala_ads set is_active=false where id=p_id;
  elsif p_action='resume' then
    update public.kafala_ads set is_active=true where id=p_id and review_status='approved' and ends_at>now();
  else raise exception 'Invalid action'; end if;
end;
$$;

create function public.kafala_review_edit(p_id uuid,p_revision uuid,p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  o kafala_private.owner_access;
begin
  if not public.is_saahl_admin() then raise exception 'Unauthorized'; end if;
  select * into o from kafala_private.owner_access where ad_id=p_id for update;
  if o.draft_status is distinct from 'pending' or o.revision is distinct from p_revision or p_approve is null then
    raise exception 'The edit has changed. Reload before reviewing.';
  end if;
  if p_approve then
    perform kafala_private.apply_fields(p_id,jsonb_populate_record(null::public.kafala_ads,o.draft));
    update kafala_private.owner_access set draft=null,draft_status=null,revision=gen_random_uuid() where ad_id=p_id;
    if exists (select 1 from public.kafala_ads where id=p_id and review_status in ('pending_review','rejected')) then
      perform public.review_kafala_ad(p_id,'approve');
    end if;
  else
    update kafala_private.owner_access set draft_status='rejected',revision=gen_random_uuid() where ad_id=p_id;
  end if;
end;
$$;

create or replace function public.kafala_track(p_token uuid)
returns table(worker_name text,review_status text,is_active boolean,created_at timestamptz,
  starts_at timestamptz,ends_at timestamptz,ad_days integer)
language sql security definer set search_path = '' as $$
  select null::text,k.review_status,k.is_active,k.created_at,k.starts_at,k.ends_at,k.ad_days
  from public.kafala_ads k where k.tracking_token=p_token
    and not exists (select 1 from kafala_private.owner_access o where o.ad_id=k.id) limit 1;
$$;

revoke execute on function public.kafala_submit_protected(uuid,text,integer,jsonb),
  public.kafala_manage(text,text,text,jsonb,text,uuid),public.kafala_pending_edits(),
  public.kafala_review_edit(uuid,uuid,boolean),public.review_kafala_ad(uuid,text),public.kafala_track(uuid)
  from public, anon, authenticated;
grant execute on function public.kafala_submit_protected(uuid,text,integer,jsonb),
  public.kafala_manage(text,text,text,jsonb,text,uuid),public.kafala_track(uuid) to anon, authenticated;
grant execute on function public.kafala_pending_edits(),public.kafala_review_edit(uuid,uuid,boolean),
  public.review_kafala_ad(uuid,text) to authenticated;

commit;
