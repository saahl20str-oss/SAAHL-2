-- SAAHL-2 in-app announcements. No historical rows or existing tables are modified.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  target text not null check(target in ('all','offices','sponsors')),
  title text not null check(char_length(btrim(title)) between 1 and 160),
  body text not null check(char_length(btrim(body)) between 1 and 4000),
  sent_at timestamptz not null default now(),
  sender_id uuid not null default auth.uid() references auth.users(id)
);
alter table public.notifications enable row level security;
revoke all on table public.notifications from anon;
grant select, insert on table public.notifications to authenticated;

create policy "saahl2_notifications_admin_insert"
on public.notifications for insert to authenticated
with check ((select public.is_saahl_admin()) and sender_id=(select auth.uid()));

create policy "saahl2_notifications_recipient_read"
on public.notifications for select to authenticated
using (
 (select public.is_saahl_admin())
 or target='all'
 or (target='offices' and exists(select 1 from public.offices o where o.owner_id=(select auth.uid())))
 or (target='sponsors' and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and lower(p.role) in ('customer','sponsor','kafeel')))
);
create index if not exists saahl2_notifications_sent_idx on public.notifications (sent_at desc);
