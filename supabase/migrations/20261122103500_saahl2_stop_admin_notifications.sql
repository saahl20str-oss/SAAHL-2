alter table public.notifications
  add column if not exists stopped_at timestamptz;

revoke update on table public.notifications from authenticated;
grant update (stopped_at) on table public.notifications to authenticated;

create policy saahl2_notifications_admin_stop
on public.notifications for update to authenticated
using ((select public.is_saahl_admin()) and stopped_at is null)
with check ((select public.is_saahl_admin()) and stopped_at is not null);

create policy saahl2_notifications_hide_stopped
on public.notifications as restrictive for select to authenticated
using (stopped_at is null or (select public.is_saahl_admin()));
