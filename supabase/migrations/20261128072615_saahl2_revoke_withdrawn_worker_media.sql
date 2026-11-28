-- Preserve withdrawal requests until the public object has been moved by Storage.
create table saahl_worker_private.withdrawn_public_media (
  worker_id uuid not null,
  object_path text not null,
  moved_at timestamptz,
  primary key (worker_id, object_path)
);
alter table saahl_worker_private.withdrawn_public_media enable row level security;
revoke all on saahl_worker_private.withdrawn_public_media from public, anon, authenticated;

create function saahl_worker_private.withdraw_worker_media(p_worker uuid, p_full boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  w public.workers%rowtype;
  v_owner uuid;
  base_url constant text := 'https://hkfxikmpfgixrbrboxeb.supabase.co/storage/v1/object/public/saahl-office-media/';
  path_pattern text;
  paths jsonb;
  waiting integer;
begin
  select workers.* into w
  from public.workers join public.offices o on o.id = workers.office_id
  where workers.id = p_worker and o.owner_id = auth.uid()
  for update of workers;
  if not found then raise exception 'Worker not found' using errcode = '42501'; end if;
  select o.owner_id into v_owner from public.offices o where o.id = w.office_id;
  path_pattern := w.office_id::text || '/workers/[A-Za-z0-9_-]+[.](png|jpg|jpeg|webp)';

  if p_full is not null then
    insert into saahl_worker_private.withdrawn_public_media(worker_id, object_path)
    select w.id, clean.path from (
      select substring(w.photo_url from char_length(base_url)+1) as path
      where starts_with(w.photo_url, base_url)
      union
      select substring(a.worker_photo_url from char_length(base_url)+1)
      from public.strip_ads a
      where starts_with(a.worker_photo_url, base_url)
        and (a.worker_id = w.id or (a.worker_id is null and a.advertiser_type = 'office'
          and (a.office_id = w.office_id or a.owner_id = v_owner)
          and substring(lower(a.ad_details) from 'worker=([0-9a-f-]{36})') = w.id::text))
      union
      select parts[1] from public.strip_ads a
      cross join lateral regexp_matches(a.ad_details, replace(base_url,'.','[.]') || '(' || path_pattern || ')', 'gi') as matches(parts)
      where a.worker_id = w.id or (a.worker_id is null and a.advertiser_type = 'office'
        and (a.office_id = w.office_id or a.owner_id = v_owner)
        and substring(lower(a.ad_details) from 'worker=([0-9a-f-]{36})') = w.id::text)
    ) candidates
    cross join lateral (select split_part(split_part(candidates.path,'?',1),'#',1) as path) clean
    where clean.path ~* ('^' || path_pattern || '$')
    on conflict (worker_id,object_path) do nothing;

    perform saahl_worker_private.saahl2_withdraw_worker_publication(p_worker,p_full);
  end if;

  select count(*)::int, coalesce(jsonb_agg(m.object_path order by m.object_path) filter (where
    not exists(select 1 from public.workers other where split_part(split_part(other.photo_url,'?',1),'#',1)=base_url||m.object_path)
    and not exists(select 1 from public.offices o where split_part(split_part(o.logo_url,'?',1),'#',1)=base_url||m.object_path)
    and not exists(select 1 from public.strip_ads a where (case
      when a.status in ('pending','approved','active')
        then split_part(split_part(a.worker_photo_url,'?',1),'#',1)=base_url||m.object_path or strpos(a.ad_details,base_url||m.object_path)>0
      else false end))
  ),'[]'::jsonb) into waiting,paths
  from saahl_worker_private.withdrawn_public_media m where m.worker_id=w.id and m.moved_at is null;
  return jsonb_build_object('waiting',waiting,'paths',paths);
end
$$;
revoke execute on function saahl_worker_private.withdraw_worker_media(uuid,boolean) from public, anon, authenticated;
grant execute on function saahl_worker_private.withdraw_worker_media(uuid,boolean) to authenticated;

create function public.saahl2_withdraw_worker_media(p_worker uuid, p_full boolean)
returns jsonb language sql security invoker set search_path = '' as $$
  select saahl_worker_private.withdraw_worker_media(p_worker,p_full)
$$;
revoke execute on function public.saahl2_withdraw_worker_media(uuid,boolean) from public, anon, authenticated;
grant execute on function public.saahl2_withdraw_worker_media(uuid,boolean) to authenticated;

create function public.saahl2_mark_worker_media_moved(p_worker uuid, p_path text)
returns void language sql security invoker set search_path = '' as $$
  update saahl_worker_private.withdrawn_public_media set moved_at=now()
  where worker_id=p_worker and object_path=p_path and moved_at is null
$$;
grant usage on schema saahl_worker_private to service_role;
grant select,update on saahl_worker_private.withdrawn_public_media to service_role;
revoke execute on function public.saahl2_mark_worker_media_moved(uuid,text) from public, anon, authenticated;
grant execute on function public.saahl2_mark_worker_media_moved(uuid,text) to service_role;

-- Older clients still record a storage task when withdrawing a publication.
create or replace function public.saahl2_withdraw_worker_publication(p_worker uuid, p_full boolean)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_full is null then raise exception 'Withdrawal scope required' using errcode = '42501'; end if;
  perform public.saahl2_withdraw_worker_media(p_worker,p_full);
end
$$;
