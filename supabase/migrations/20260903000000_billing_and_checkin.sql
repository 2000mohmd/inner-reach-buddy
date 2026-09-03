-- Three additive features, bundled because they landed together:
--   1. Stripe subscription billing (test mode first — swapping in the live
--      secret key later is just an env var change, no schema change needed).
--   2. A distinct nudge trigger type for the 12-hour "haven't heard from you
--      in chat" proactive check-in, separate from the existing 4-day
--      mood/habit-based `inactivity` trigger (different signal, different
--      cooldown, delivered as a real chat message rather than a nudge card).
--   3. Device push tokens, so the mobile client has somewhere to register once
--      it asks the OS for notification permission. The OS-level permission
--      prompt and token retrieval must happen in the mobile app itself; this
--      table plus the sender helper is the backend half of that handshake.

-- ---------------------------------------------------------------------------
-- 1. Stripe billing fields on profiles + webhook idempotency table
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_price_id text,
  add column if not exists stripe_subscription_status text,
  add column if not exists subscription_current_period_end timestamptz;

create unique index if not exists profiles_stripe_customer_id_idx
  on public.profiles (stripe_customer_id)
  where stripe_customer_id is not null;

-- Records every processed Stripe event id so a redelivered webhook (Stripe
-- retries on anything but a 2xx) never double-applies a subscription change.
-- Service role only — the webhook handler runs with the admin client.
create table if not exists public.stripe_webhook_events (
  id           text primary key, -- Stripe event id, e.g. evt_...
  type         text not null,
  processed_at timestamptz not null default now()
);
alter table public.stripe_webhook_events enable row level security;
revoke all on public.stripe_webhook_events from anon, authenticated;
grant all on public.stripe_webhook_events to service_role;

-- ---------------------------------------------------------------------------
-- 2. New nudge trigger type for the 12h chat check-in
-- ---------------------------------------------------------------------------
-- NOTE: keep 'commitment_follow_up' here too — migration 20260902000500 added
-- it, and this DROP + re-ADD would otherwise silently remove it.
do $$
begin
  alter table public.nudges drop constraint if exists nudges_trigger_type_check;
  alter table public.nudges
    add constraint nudges_trigger_type_check
    check (trigger_type in (
      'low_mood_streak', 'inactivity', 'screener_step_up', 'sustained_distress',
      'commitment_follow_up', 'chat_checkin_12h'
    ));
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Device push tokens
-- ---------------------------------------------------------------------------
create table if not exists public.device_push_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  platform   text not null check (platform in ('ios', 'android')),
  token      text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, token)
);
grant select, insert, update, delete on public.device_push_tokens to authenticated;
grant all on public.device_push_tokens to service_role;
alter table public.device_push_tokens enable row level security;
create policy "Users manage own push tokens" on public.device_push_tokens
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create index if not exists device_push_tokens_user_idx on public.device_push_tokens (user_id);
