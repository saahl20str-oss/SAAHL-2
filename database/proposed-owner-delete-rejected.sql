-- SAAHL-2: additive, PIN-verified deletion of rejected, inactive transfer requests.
-- Existing public.kafala_manage_request and expired deletion are NOT modified.
-- No data changes at migration time. A user-triggered call deletes only an authenticated rejected request.
CREATE OR REPLACE FUNCTION public.kafala_delete_rejected_owner(p_number text, p_pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_access jsonb;
  v_ad uuid;
  v_number text;
BEGIN
  -- Existing owner auth validates number, checks PIN and enforces lockout.
  v_access := public.kafala_manage_request(p_number,p_pin,'open');
  IF v_access ? 'error' THEN
    RETURN jsonb_build_object('error',v_access->>'error');
  END IF;
  v_number := v_access->>'request_number';
  SELECT o.ad_id INTO v_ad
  FROM kafala_private.owner_access o
  JOIN kafala_private.request_numbers n USING (creation_key)
  WHERE n.number=v_number
  FOR UPDATE OF o;
  IF v_ad IS NULL THEN
    RETURN jsonb_build_object('error','invalid');
  END IF;

  DELETE FROM public.kafala_ads a
  WHERE a.id=v_ad
    AND a.review_status='rejected'
    AND a.is_active=false
    AND EXISTS (
      SELECT 1 FROM kafala_private.owner_access o
      WHERE o.ad_id=a.id AND o.draft_status IS DISTINCT FROM 'pending'
    );

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error','not_deletable');
  END IF;
  RETURN jsonb_build_object('deleted',true,'request_number',v_number);
END;
$function$;

REVOKE ALL ON FUNCTION public.kafala_delete_rejected_owner(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kafala_delete_rejected_owner(text,text) TO anon,authenticated;
