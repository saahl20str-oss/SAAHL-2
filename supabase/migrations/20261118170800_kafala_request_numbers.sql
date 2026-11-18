begin;

create table kafala_private.request_numbers (
  creation_key uuid primary key,
  number text unique not null,
  created_at timestamptz not null default now(),
  issued boolean not null default false
);
alter table kafala_private.request_numbers enable row level security;
revoke all on kafala_private.request_numbers from public,anon,authenticated;
create index kafala_unissued_request_numbers on kafala_private.request_numbers(created_at) where not issued;

create function kafala_private.reserve_number(p_request uuid)
returns text language plpgsql set search_path='' as $$
declare
  v_number text;
begin
  if p_request is null then raise exception 'Invalid request'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
  select number into v_number from kafala_private.request_numbers where creation_key=p_request;
  if found then return v_number; end if;
  loop
    v_number := lpad((('x'||encode(extensions.gen_random_bytes(4),'hex'))::bit(32)::bigint % 100000000)::text,8,'0');
    insert into kafala_private.request_numbers(creation_key,number) values(p_request,v_number)
      on conflict (number) do nothing;
    if found then return v_number; end if;
  end loop;
end;
$$;

create function kafala_private.issue_number()
returns trigger language plpgsql set search_path='' as $$
begin
  perform kafala_private.reserve_number(new.creation_key);
  update kafala_private.request_numbers set issued=true where creation_key=new.creation_key and not issued;
  if not found then raise exception 'Request was already issued'; end if;
  return new;
end;
$$;

create trigger kafala_issue_request_number after insert on kafala_private.owner_access
for each row execute function kafala_private.issue_number();

select kafala_private.reserve_number(creation_key) from kafala_private.owner_access;
update kafala_private.request_numbers set issued=true;

create function public.kafala_reserve_number(p_request uuid)
returns text language plpgsql security definer set search_path='' as $$
begin
  delete from kafala_private.request_numbers where creation_key in (
    select creation_key from kafala_private.request_numbers
    where not issued and created_at<now()-interval '7 days' and creation_key<>p_request
    order by created_at limit 25 for update skip locked
  );
  return kafala_private.reserve_number(p_request);
end;
$$;

create function public.kafala_submit_numbered(p_request uuid,p_number text,p_pin text,p_days integer,p_fields jsonb)
returns text language plpgsql security definer set search_path='' as $$
declare
  v_number text;
begin
  if p_request is null then raise exception 'Invalid request'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
  select number into v_number from kafala_private.request_numbers where creation_key=p_request for update;
  if v_number is null or v_number is distinct from p_number then
    raise exception 'Request number expired' using errcode='P4100';
  end if;
  perform public.kafala_submit_protected(p_request,p_pin,p_days,p_fields);
  return v_number;
end;
$$;

create function kafala_private.remove_expired(p_id uuid)
returns boolean language plpgsql set search_path='' as $$
begin
  perform 1 from kafala_private.owner_access where ad_id=p_id for update;
  delete from public.kafala_ads where id=p_id and review_status='approved' and ends_at<=clock_timestamp();
  return found;
end;
$$;

create function public.kafala_delete_expired(p_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if not public.is_saahl_admin() then raise exception 'Unauthorized'; end if;
  return kafala_private.remove_expired(p_id);
end;
$$;

create function public.kafala_manage_request(p_number text,p_pin text,p_action text,p_fields jsonb default null,
  p_new_pin text default null,p_revision uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_old text;
  v_number text;
  v_ad uuid;
  v_access jsonb;
begin
  if p_number ~ '^[0-9]{8}$' then
    select o.request_number,n.number,o.ad_id into v_old,v_number,v_ad
    from kafala_private.request_numbers n join kafala_private.owner_access o using (creation_key)
    where n.number=p_number;
  elsif p_number ~ '^[0-9A-F]{16}$' then
    select o.request_number,n.number,o.ad_id into v_old,v_number,v_ad
    from kafala_private.owner_access o join kafala_private.request_numbers n using (creation_key)
    where o.request_number=p_number;
  end if;
  if v_ad is null then return jsonb_build_object('error','invalid'); end if;
  v_access := public.kafala_manage(v_old,p_pin,case when p_action='delete' then 'open' else p_action end,
    p_fields,p_new_pin,p_revision);
  if v_access ? 'error' then return v_access; end if;
  if p_action='delete' then
    if not kafala_private.remove_expired(v_ad) then return jsonb_build_object('error','not_expired'); end if;
    return jsonb_build_object('deleted',true,'request_number',v_number);
  end if;
  return v_access || jsonb_build_object('request_number',v_number,'expired',
    v_access->>'status'='approved' and (v_access->>'ends_at')::timestamptz<=clock_timestamp());
end;
$$;

revoke execute on function public.kafala_reserve_number(uuid),public.kafala_submit_numbered(uuid,text,text,integer,jsonb),
  public.kafala_manage_request(text,text,text,jsonb,text,uuid),public.kafala_delete_expired(uuid)
  from public,anon,authenticated;
grant execute on function public.kafala_reserve_number(uuid),public.kafala_submit_numbered(uuid,text,text,integer,jsonb),
  public.kafala_manage_request(text,text,text,jsonb,text,uuid) to anon,authenticated;
grant execute on function public.kafala_delete_expired(uuid) to authenticated;

commit;
