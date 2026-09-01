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

create index if not exists job_queue_pending_idx
  on public.job_queue (run_after)
  where completed_at is null;

revoke all on public.job_queue from anon, authenticated;
grant all on public.job_queue to service_role;
alter table public.job_queue enable row level security;

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
-- sweep_state
-- ---------------------------------------------------------------------------
create table if not exists public.sweep_state (
  name         text primary key,
  cursor_value text,
  updated_at   timestamptz not null default now()
);

revoke all on public.sweep_state from anon, authenticated;
grant all on public.sweep_state to service_role;
alter table public.sweep_state enable row level security;

-- ---------------------------------------------------------------------------
-- chat rate limit daily cap + chat_usage
-- ---------------------------------------------------------------------------
alter table public.chat_rate_limits
  add column if not exists day_start date,
  add column if not exists day_count integer not null default 0;

create table if not exists public.chat_usage (
  user_id                uuid primary key references auth.users(id) on delete cascade,
  day                    date not null default (now() at time zone 'utc')::date,
  day_messages           integer not null default 0,
  day_input_tokens       bigint  not null default 0,
  day_output_tokens      bigint  not null default 0,
  lifetime_messages      bigint  not null default 0,
  lifetime_input_tokens  bigint  not null default 0,
  lifetime_output_tokens bigint  not null default 0,
  updated_at             timestamptz not null default now()
);

grant select, insert, update on public.chat_usage to authenticated;
grant all on public.chat_usage to service_role;
alter table public.chat_usage enable row level security;

drop policy if exists "Users manage own chat usage" on public.chat_usage;
create policy "Users manage own chat usage" on public.chat_usage
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Admins can view chat usage" on public.chat_usage;
create policy "Admins can view chat usage" on public.chat_usage
  for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));