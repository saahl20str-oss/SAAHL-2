begin;
alter table public.kafala_ads
  add column publish_worker_photo boolean not null default false,
  add column publish_worker_details boolean not null default false,
  add column public_profile_consent_at timestamptz;

-- Reuse the existing list's scope and review requirements.
create function public.saahl2_public_transfer_profiles()
returns table(id uuid, profession text, emirate text, age integer, experience_years integer,
  monthly_salary numeric, ends_at timestamptz, nationality text, skills text[], worker_photo_url text)
language sql stable security definer set search_path = '' as $$
  select a.*, case when k.publish_worker_details then k.nationality::text end,
    case when k.publish_worker_details then k.skills end,
    case when k.publish_worker_photo
      and length(k.worker_photo_url)<=700000
      and k.worker_photo_url ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$'
    then k.worker_photo_url end
  from public.saahl2_public_transfers() a
  join public.kafala_ads k on k.id=a.id
  order by k.created_at desc;
$$;
revoke execute on function public.saahl2_public_transfer_profiles() from public,anon,authenticated;
grant execute on function public.saahl2_public_transfer_profiles() to anon,authenticated;

-- The numbered submission and PIN-protected edit both use the same fields.
create or replace function kafala_private.apply_fields(p_id uuid, v public.kafala_ads)
returns void language sql set search_path = '' as $$
  update public.kafala_ads set
    worker_name=v.worker_name,nationality=v.nationality,age=v.age,profession=v.profession,
    experience_years=v.experience_years,monthly_salary=v.monthly_salary,religion=v.religion,
    current_status=v.current_status,emirate=v.emirate,skills=v.skills,reason=v.reason,
    contact_phone=v.contact_phone,sponsor_display_name=v.sponsor_display_name,worker_photo_url=v.worker_photo_url,
    publish_worker_photo=coalesce(v.publish_worker_photo,false) and v.worker_photo_url is not null,
    publish_worker_details=coalesce(v.publish_worker_details,false),
    public_profile_consent_at=case when coalesce(v.publish_worker_photo,false) and v.worker_photo_url is not null
      or coalesce(v.publish_worker_details,false) then now() end
  where id=p_id;
$$;

create or replace function public.kafala_review_edit(p_id uuid,p_revision uuid,p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  o kafala_private.owner_access;
  a public.kafala_ads;
  actor uuid := auth.uid();
begin
  if actor is null or not coalesce(public.is_saahl_admin(),false) then raise insufficient_privilege; end if;
  select * into o from kafala_private.owner_access where ad_id=p_id for update;
  if not found or o.draft_status is distinct from 'pending' or o.revision is distinct from p_revision or p_approve is null then
    raise exception 'The edit has changed. Reload before reviewing.';
  end if;
  if not p_approve then
    update kafala_private.owner_access set draft_status='rejected',revision=gen_random_uuid() where ad_id=p_id;
    return;
  end if;
  select * into strict a from public.kafala_ads where id=p_id for update;
  if a.launch_declarations_at is null and a.launch_verified_at is null then
    raise exception 'Valid transfer declarations required' using errcode='23514';
  end if;
  perform kafala_private.apply_fields(p_id,kafala_private.validated(o.draft));
  update kafala_private.owner_access set draft=null,draft_status=null,revision=gen_random_uuid() where ad_id=p_id;
  -- Record the editor's review before activating. Keep the original expiry for published ads.
  update public.kafala_ads set launch_verified_at=now(),launch_verified_by=actor,
    launch_evidence_ref=coalesce(a.launch_evidence_ref,'advertiser-declarations:'||p_id::text)
  where id=p_id;
  if a.review_status in ('pending_review','rejected') then
    perform public.review_kafala_ad(p_id,'approve');
  elsif a.review_status='approved' and a.is_active and a.ends_at>now() then
    update public.kafala_ads set is_active=true where id=p_id;
  end if;
end;
$$;
commit;
