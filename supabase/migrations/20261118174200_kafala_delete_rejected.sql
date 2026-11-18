begin;

create function public.kafala_delete_rejected(p_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare
  v_draft_status text;
begin
  if not public.is_saahl_admin() then raise exception 'Unauthorized'; end if;
  select draft_status into v_draft_status from kafala_private.owner_access where ad_id=p_id for update;
  if v_draft_status='pending' then return false; end if;
  delete from public.kafala_ads where id=p_id and review_status='rejected' and not is_active;
  return found;
end;
$$;

revoke execute on function public.kafala_delete_rejected(uuid) from public,anon,authenticated;
grant execute on function public.kafala_delete_rejected(uuid) to authenticated;

commit;
