begin;
alter table public.kafala_ads
  add column whatsapp_contact_allowed boolean not null default false;

create function kafala_private.whatsapp_number(raw text)
returns text language sql immutable strict set search_path = '' as $$
  with cleaned as (
    select regexp_replace(translate(raw,'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'),'[^+0-9]','','g') as phone
  )
  select case
    when phone ~ '^0[234679][0-9]{7}$|^05[0-9]{8}$' then '971'||substr(phone,2)
    when phone ~ '^971([234679][0-9]{7}|5[0-9]{8})$' then phone
    when phone ~ '^([+]|00)971([234679][0-9]{7}|5[0-9]{8})$' then regexp_replace(phone,'^([+]|00)','')
    when phone !~ '^([+]|00)971' and phone ~ '^([+]|00)[1-9][0-9]{7,14}$' then regexp_replace(phone,'^([+]|00)','')
  end
  from cleaned;
$$;

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
      or coalesce(v.publish_worker_details,false) then now() end,
    whatsapp_contact_allowed=coalesce(v.whatsapp_contact_allowed,false)
      and kafala_private.whatsapp_number(v.contact_phone) is not null
  where id=p_id;
$$;

create function public.saahl2_transfer_whatsapp(p_ad uuid)
returns text language sql stable security definer set search_path = '' as $$
  select kafala_private.whatsapp_number(a.contact_phone)
  from public.saahl2_public_transfers() p
  join public.kafala_ads a on a.id=p.id
  where p.id=p_ad and a.whatsapp_contact_allowed;
$$;
revoke execute on function public.saahl2_transfer_whatsapp(uuid) from public,anon,authenticated;
grant execute on function public.saahl2_transfer_whatsapp(uuid) to anon,authenticated;
commit;
