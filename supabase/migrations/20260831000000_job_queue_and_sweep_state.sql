-- Deferred background job queue + resumable sweep cursor. Additive only; safe
-- to apply while the app is running.
--
-- WHY: chat replies must not wait on slow background work — thread summaries and
-- the Phase 11 session-drift crisis sweep in particular. Producers INSERT a row
-- into job_queue and return immediately; the scheduled sweep
-- (/api/public/hooks/evaluate-nudges) drains it with a wall-clock budget.
--
-- This migration does NOT decide how the schedule is powered. Cloudflare Queues,
-- Supabase pg_cron + pg_net, or an external cron all work by calling the sweep
-- endpoint. See src/jobs/queue.ts.

-- ---------------------------------------------------------------------------
-- job_queue
-- ---------------------------------------------------------------------------
create table if not exists public.job_queue (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null,
  payload       jsonb not null default '{}'::jsonb,
  run_after     timestamptz not null default now(),
  locked_at     timestamptz,
  attempts      integer not null default 0,
  last_error    text,
  dead_lettered boolean not null default false,
  completed_at  timestamptz,
  created_at    timestamptz not null default now()
);

-- Access path for the claim query: pending, due jobs, oldest first.
create index if not exists job_queue_pending_idx
  on public.job_queue (run_after)
  where completed_at is null;

alter table public.job_queue enable row level security;
-- Service role only. No policy for anon/authenticated == no client access.
revoke all on public.job_queue from anon, authenticated;
grant all on public.job_queue to service_role;

-- Atomic batch claim with SKIP LOCKED so overlapping sweeps never double-run a
-- job. Also re-claims rows whose lock is older than 5 minutes (crashed worker).
create or replace function public.claim_jobs(p_limit integer)
returns setof public.job_queue
language sql
security definer
set search_path = public
as $$
  update public.job_queue q
     set locked_at = now()
   where q.id in (
     select id
       from public.job_queue
      where completed_at is null
        and run_after <= now()
        and (locked_at is null or locked_at < now() - interval '5 minutes')
      order by run_after
      limit greatest(coalesce(p_limit, 0), 0)
      for update skip locked
   )
  returning q.*;
$$;

revoke all on function public.claim_jobs(integer) from anon, authenticated;
grant execute on function public.claim_jobs(integer) to service_role;

-- ---------------------------------------------------------------------------
-- sweep_state  — tiny KV of resumable cursors, one row per sweep name.
-- ---------------------------------------------------------------------------
create table if not exists public.sweep_state (
  name         text primary key,
  cursor_value text,
  updated_at   timestamptz not null default now()
);

alter table public.sweep_state enable row level security;
revoke all on public.sweep_state from anon, authenticated;
grant all on public.sweep_state to service_role;

-- ---------------------------------------------------------------------------
-- Schedule: pg_cron + pg_net  (transport decision: Supabase-native polling)
-- ---------------------------------------------------------------------------
-- Every minute, POST the sweep endpoint. The endpoint itself is idempotent,
-- budget-bounded and cursor-resumable (see the route), so a 1-minute cadence
-- with occasional overlap is safe.
--
-- SECRETS ARE NOT STORED IN THIS FILE. The sweep URL and NUDGE_SWEEP_SECRET are
-- read from Supabase Vault at call time. Before this schedule can work, run the
-- one-time bootstrap below ONCE with your real values (Dashboard → SQL editor,
-- or psql). Re-running create_secret with the same name errors — use
-- vault.update_secret to change a value later.
--
--   select vault.create_secret(
--     'https://<your-app-host>/api/public/hooks/evaluate-nudges', 'kalm_sweep_url');
--   select vault.create_secret('<your NUDGE_SWEEP_SECRET value>', 'kalm_sweep_secret');
--
-- To rotate:
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'kalm_sweep_secret'), '<new value>');

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Recreate the schedule idempotently.
select cron.unschedule('kalm-evaluate-nudges')
where exists (select 1 from cron.job where jobname = 'kalm-evaluate-nudges');

select cron.schedule(
  'kalm-evaluate-nudges',
  '* * * * *',
  $cron$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'kalm_sweep_url'),
    headers := jsonb_build_object(
      'Content-Type',   'application/json',
      'x-sweep-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'kalm_sweep_secret')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $cron$
);
