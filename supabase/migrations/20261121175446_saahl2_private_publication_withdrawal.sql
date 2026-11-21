-- Keep the privileged operation in the existing non-exposed worker schema.
alter function public.saahl2_withdraw_worker_publication(uuid,boolean)
  set schema saahl_worker_private;
grant usage on schema saahl_worker_private to authenticated;

create function public.saahl2_withdraw_worker_publication(p_worker uuid, p_full boolean)
returns void language sql security invoker set search_path = '' as $$
  select saahl_worker_private.saahl2_withdraw_worker_publication(p_worker,p_full)
$$;
revoke execute on function public.saahl2_withdraw_worker_publication(uuid,boolean) from public, anon, authenticated;
grant execute on function public.saahl2_withdraw_worker_publication(uuid,boolean) to authenticated;

alter function public.saahl2_guard_strip_worker_consent() set schema saahl_worker_private;
