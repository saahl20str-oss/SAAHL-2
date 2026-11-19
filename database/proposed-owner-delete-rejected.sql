-- SAAHL-2 proposed authorization update. DO NOT run without a database backup
-- and a staging test of approved/pending/rejected/expired request states.
-- Changes only public.kafala_manage_request. Never touches the original SAAHL project.
CREATE OR REPLACE FUNCTION public.kafala_manage_request(
  p_number text,
  p_pin text,
  p_action text,
  p_fields jsonb DEFAULT NULL::jsonb,
  p_new_pin text DEFAULT NULL::text,
  p_revision uuid DEFAULT NULL::uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_old text;
  v_number text;
  v_ad uuid;
  v_access jsonb;
BEGIN
  IF p_number ~ '^[0-9]{8}$' THEN
    SELECT o.request_number,n.number,o.ad_id INTO v_old,v_number,v_ad
    FROM kafala_private.request_numbers n JOIN kafala_private.owner_access o USING (creation_key)
    WHERE n.number=p_number;
  ELSIF p_number ~ '^[0-9A-F]{16}$' THEN
    SELECT o.request_number,n.number,o.ad_id INTO v_old,v_number,v_ad
    FROM kafala_private.owner_access o JOIN kafala_private.request_numbers n USING (creation_key)
    WHERE o.request_number=p_number;
  END IF;
  IF v_ad IS NULL THEN RETURN jsonb_build_object('error','invalid'); END IF;

  -- Preserve the existing PIN verification, lockout, and row locking.
  v_access := public.kafala_manage(v_old,p_pin,CASE WHEN p_action='delete' THEN 'open' ELSE p_action END,
                                   p_fields,p_new_pin,p_revision);
  IF v_access ? 'error' THEN RETURN v_access; END IF;

  IF p_action='delete' THEN
    -- Only the verified request owner may delete rejected, inactive ads
    -- with no pending moderation changes. Preserve pending/published ads.
    IF EXISTS (
      SELECT 1 FROM kafala_private.owner_access o
      JOIN public.kafala_ads k ON k.id=o.ad_id
      WHERE o.ad_id=v_ad
        AND k.review_status='rejected'
        AND k.is_active=false
        AND o.draft_status IS DISTINCT FROM 'pending'
    ) THEN
      DELETE FROM public.kafala_ads k
      WHERE k.id=v_ad AND k.review_status='rejected' AND k.is_active=false;
      IF FOUND THEN RETURN jsonb_build_object('deleted',true,'request_number',v_number); END IF;
    END IF;
    IF NOT kafala_private.remove_expired(v_ad) THEN
      RETURN jsonb_build_object('error','not_deletable');
    END IF;
    RETURN jsonb_build_object('deleted',true,'request_number',v_number);
  END IF;
  RETURN v_access || jsonb_build_object(
    'request_number',v_number,
    'expired', v_access->>'status'='approved'
       AND (v_access->>'ends_at')::timestamptz<=clock_timestamp()
  );
END;
$function$;
