-- Public and signed-in card queries use an explicit projection.
revoke select on public.workers from anon, authenticated;
revoke select (publication_consent_ref) on public.workers from anon, authenticated;
grant select (id, office_id, display_name, nationality, age, experience_years,
  salary_aed, skills, languages, photo_url, description, status, created_at,
  country_experience, worker_number, religion, publication_consent_at,
  publication_photo_draft) on public.workers to anon, authenticated;

