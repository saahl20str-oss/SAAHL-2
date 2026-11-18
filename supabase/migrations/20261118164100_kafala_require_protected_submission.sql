begin;

revoke all on public.kafala_ads from public,anon,authenticated;
grant select (id,worker_name,nationality,age,profession,experience_years,current_status,emirate,
  skills,reason,contact_phone,sponsor_display_name,ad_days,starts_at,ends_at,is_active,
  created_at,review_status,worker_photo_url,monthly_salary,religion) on public.kafala_ads to anon,authenticated;

drop policy if exists trial_kafala_submit on public.kafala_ads;
drop policy if exists admin_review_kafala_update on public.kafala_ads;
alter policy public_active_kafala_only on public.kafala_ads
  using (is_active and review_status='approved' and ends_at>now());

commit;
