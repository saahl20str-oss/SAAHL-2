-- Rollback snapshot of the existing SAAHL-2 function prior to the mobile release.
CREATE OR REPLACE FUNCTION public.kafala_manage_request(p_number text, p_pin text, p_action text, p_fields jsonb DEFAULT NULL::jsonb, p_new_pin text DEFAULT NULL::text, p_revision uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$

