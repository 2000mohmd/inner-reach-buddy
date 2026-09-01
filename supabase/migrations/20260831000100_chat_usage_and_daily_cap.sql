-- Chat rate-limit hardening: a daily message cap alongside the existing short
-- sliding window, plus a durable per-user token / cost counter. Additive only.

-- ---------------------------------------------------------------------------
-- Daily cap counters live on the existing hot-path row (one read + one write
-- per message, unchanged). This whole table is what a future Redis limiter
-- would take over.
-- ---------------------------------------------------------------------------
alter table public.chat_rate_limits
  add column if not exists day_start date,
  add column if not exists day_count integer not null default 0;

-- ---------------------------------------------------------------------------
-- chat_usage — the visible token / estimated-cost counter. Written once per
-- completed chat exchange (fire-and-forget), never on the pre-flight path.
-- Stays in Postgres regardless of the rate-limit transport decision.
-- ---------------------------------------------------------------------------
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

create policy "Users manage own chat usage" on public.chat_usage
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Admins can view chat usage" on public.chat_usage
  for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));
