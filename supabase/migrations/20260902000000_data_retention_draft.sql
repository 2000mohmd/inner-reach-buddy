-- DRAFT — data retention (item 10). NOT scheduled. Safe to apply: it only
-- creates a function that DEFAULTS TO DRY RUN and deletes nothing until called
-- with p_dry_run => false. Confirm the windows in docs/DATA_RETENTION.md first.
--
--   select * from public.purge_expired_data();            -- dry run: counts only
--   select * from public.purge_expired_data(p_dry_run => false);  -- actually delete
--
-- Never touched: crisis_events, admin_audit_log, screener_responses, mood_logs,
-- exercise_completions (see the doc for why).

create or replace function public.purge_expired_data(p_dry_run boolean default true)
returns table (table_name text, would_delete bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  -- ---- retention windows (edit here) --------------------------------------
  chat_window        interval := interval '26 months';
  summary_window     interval := interval '26 months';
  support_window     interval := interval '24 months';
  digest_window      interval := interval '24 months';
  nudge_window       interval := interval '12 months';
  notif_delivered    interval := interval '90 days';
  notif_undelivered  interval := interval '30 days';
  job_window         interval := interval '14 days';
  -- ----------------------------------------------------------------------------
  n bigint;
begin
  -- chat_messages in stale threads
  if p_dry_run then
    select count(*) into n from public.chat_messages m
      join public.chat_threads t on t.id = m.thread_id
      where t.updated_at < now() - chat_window;
  else
    with d as (
      delete from public.chat_messages m
        using public.chat_threads t
        where t.id = m.thread_id and t.updated_at < now() - chat_window
        returning 1
    ) select count(*) into n from d;
  end if;
  table_name := 'chat_messages'; would_delete := n; return next;

  -- thread_summaries for stale threads
  if p_dry_run then
    select count(*) into n from public.thread_summaries s
      where s.created_at < now() - summary_window;
  else
    with d as (
      delete from public.thread_summaries where created_at < now() - summary_window returning 1
    ) select count(*) into n from d;
  end if;
  table_name := 'thread_summaries'; would_delete := n; return next;

  -- chat_threads: stale AND now empty of messages
  if p_dry_run then
    select count(*) into n from public.chat_threads t
      where t.updated_at < now() - chat_window
        and not exists (select 1 from public.chat_messages m where m.thread_id = t.id);
  else
    with d as (
      delete from public.chat_threads t
        where t.updated_at < now() - chat_window
          and not exists (select 1 from public.chat_messages m where m.thread_id = t.id)
        returning 1
    ) select count(*) into n from d;
  end if;
  table_name := 'chat_threads'; would_delete := n; return next;

  -- support_messages / support_threads in stale threads
  if p_dry_run then
    select count(*) into n from public.support_messages sm
      join public.support_threads st on st.id = sm.thread_id
      where st.updated_at < now() - support_window;
  else
    with d as (
      delete from public.support_messages sm using public.support_threads st
        where st.id = sm.thread_id and st.updated_at < now() - support_window returning 1
    ) select count(*) into n from d;
  end if;
  table_name := 'support_messages'; would_delete := n; return next;

  if p_dry_run then
    select count(*) into n from public.support_threads st
      where st.updated_at < now() - support_window
        and not exists (select 1 from public.support_messages sm where sm.thread_id = st.id);
  else
    with d as (
      delete from public.support_threads st
        where st.updated_at < now() - support_window
          and not exists (select 1 from public.support_messages sm where sm.thread_id = st.id)
        returning 1
    ) select count(*) into n from d;
  end if;
  table_name := 'support_threads'; would_delete := n; return next;

  -- weekly_digests
  if p_dry_run then
    select count(*) into n from public.weekly_digests where created_at < now() - digest_window;
  else
    with d as (delete from public.weekly_digests where created_at < now() - digest_window returning 1)
      select count(*) into n from d;
  end if;
  table_name := 'weekly_digests'; would_delete := n; return next;

  -- nudges
  if p_dry_run then
    select count(*) into n from public.nudges where created_at < now() - nudge_window;
  else
    with d as (delete from public.nudges where created_at < now() - nudge_window returning 1)
      select count(*) into n from d;
  end if;
  table_name := 'nudges'; would_delete := n; return next;

  -- notification_queue
  if p_dry_run then
    select count(*) into n from public.notification_queue
      where (delivered_at is not null and delivered_at < now() - notif_delivered)
         or (delivered_at is null and created_at < now() - notif_undelivered);
  else
    with d as (
      delete from public.notification_queue
        where (delivered_at is not null and delivered_at < now() - notif_delivered)
           or (delivered_at is null and created_at < now() - notif_undelivered)
        returning 1
    ) select count(*) into n from d;
  end if;
  table_name := 'notification_queue'; would_delete := n; return next;

  -- job_queue (completed / dead-lettered)
  if p_dry_run then
    select count(*) into n from public.job_queue where completed_at is not null and completed_at < now() - job_window;
  else
    with d as (
      delete from public.job_queue where completed_at is not null and completed_at < now() - job_window returning 1
    ) select count(*) into n from d;
  end if;
  table_name := 'job_queue'; would_delete := n; return next;

  return;
end;
$$;

revoke all on function public.purge_expired_data(boolean) from anon, authenticated;
grant execute on function public.purge_expired_data(boolean) to service_role;

-- ---------------------------------------------------------------------------
-- Enable AFTER the dry-run numbers are confirmed. Runs nightly at 03:30 UTC.
-- ---------------------------------------------------------------------------
-- create extension if not exists pg_cron;
-- select cron.unschedule('kalm-purge-expired')
--   where exists (select 1 from cron.job where jobname = 'kalm-purge-expired');
-- select cron.schedule(
--   'kalm-purge-expired', '30 3 * * *',
--   $cron$ select public.purge_expired_data(p_dry_run => false); $cron$
-- );
