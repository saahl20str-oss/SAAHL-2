begin;

-- Expose contact availability for the existing public profiles without
-- returning the advertiser's number before the visitor chooses to contact them.
create function public.saahl2_public_transfer_profiles_with_availability()
returns table(
  id uuid, profession text, emirate text, age integer, experience_years integer,
  monthly_salary numeric, ends_at timestamptz, nationality text, skills text[],
  worker_photo_url text, whatsapp_available boolean
)
language sql stable security invoker set search_path = '' as $$
  select profile.*, public.saahl2_transfer_whatsapp(profile.id) is not null
  from public.saahl2_public_transfer_profiles() as profile;
$$;

revoke execute on function public.saahl2_public_transfer_profiles_with_availability()
  from public, anon, authenticated;
grant execute on function public.saahl2_public_transfer_profiles_with_availability()
  to anon, authenticated;

commit;
