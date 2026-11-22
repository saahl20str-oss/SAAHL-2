-- Allow an office to add its first private attachment after approval too.
alter policy saahl2_license_pending_owner_upload on storage.objects
with check (
  bucket_id = 'saahl2-office-licenses'
  and exists (
    select 1 from public.offices o
    where o.owner_id = (select auth.uid()) and o.status in ('pending', 'approved')
      and storage.objects.name = o.id::text || '/license'
  )
);

-- Owners can check whether their attachment is present. Only administrators
-- get the contact address. The file stays under the existing admin read policy.
create function saahl_worker_private.office_license_review(p_office uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  is_admin boolean;
  office_owner uuid;
  contact_email text;
begin
  if actor is null then raise insufficient_privilege; end if;
  is_admin := coalesce(public.is_saahl_admin(), false);
  select owner_id into office_owner from public.offices where id = p_office;
  if not found or (not is_admin and office_owner is distinct from actor) then
    raise insufficient_privilege;
  end if;
  if is_admin then
    select email into contact_email from auth.users where id = office_owner and email_confirmed_at is not null;
  end if;
  return jsonb_build_object(
    'has_attachment', exists (
      select 1 from storage.objects f where f.bucket_id = 'saahl2-office-licenses'
        and f.name = p_office::text || '/license'
    ),
    'contact_email', contact_email
  );
end;
$$;

grant usage on schema saahl_worker_private to authenticated;
revoke all on function saahl_worker_private.office_license_review(uuid) from public, anon, authenticated;
grant execute on function saahl_worker_private.office_license_review(uuid) to authenticated;

create function public.saahl2_office_license_review(p_office uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select saahl_worker_private.office_license_review(p_office)
$$;
revoke all on function public.saahl2_office_license_review(uuid) from public, anon, authenticated;
grant execute on function public.saahl2_office_license_review(uuid) to authenticated;
