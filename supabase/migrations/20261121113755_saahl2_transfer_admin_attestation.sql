-- Approve an initial transfer request using its recorded advertiser declarations.
-- The marker identifies the basis of approval; it is not documentary verification.
create function public.saahl2_approve_declared_transfer(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  ad public.kafala_ads%rowtype;
begin
  if actor is null or not coalesce(public.is_saahl_admin(),false) then
    raise insufficient_privilege;
  end if;
  -- Match the lock order used by review_kafala_ad and owner edit review.
  perform 1 from kafala_private.owner_access where ad_id=p_id for update;
  select * into ad from public.kafala_ads where id=p_id for update;
  if not found or ad.review_status is distinct from 'pending_review' then
    raise exception 'Transfer is no longer pending' using errcode='22023';
  end if;
  if ad.launch_declarations_at is null or ad.age is null or ad.age not between 18 and 60 then
    raise exception 'Valid transfer declarations required' using errcode='23514';
  end if;
  if ad.launch_verified_at is null then
    update public.kafala_ads
      set launch_verified_at=now(), launch_verified_by=actor,
          launch_evidence_ref='advertiser-declarations:'||p_id::text
    where id=p_id;
  end if;
  perform public.review_kafala_ad(p_id,'approve');
end;
$$;
revoke execute on function public.saahl2_approve_declared_transfer(uuid) from public,anon,authenticated;
grant execute on function public.saahl2_approve_declared_transfer(uuid) to authenticated;
