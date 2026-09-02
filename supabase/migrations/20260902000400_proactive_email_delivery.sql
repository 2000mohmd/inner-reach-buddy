-- Phase 2: email delivery for the proactive engine (nudges + weekly digest).
--
-- Until now the nudge engine and the weekly digest generator wrote rows that
-- only ever surfaced in-app (NudgeFeed / Insights). This adds the pieces needed
-- to also push a *content-free* "there's something for you in Kalm" email:
--
--   1. profiles.email_opt_out  — a single per-user opt-out (a full per-type
--      preferences screen comes later). Default false = receiving; every email
--      still carries a one-click unsubscribe link + List-Unsubscribe header that
--      flips this to true (see src/routes/api/public/unsubscribe.ts).
--   2. nudges.emailed_at / weekly_digests.emailed_at — stamped once an email has
--      gone out (or been deliberately skipped) so nothing is emailed twice.
--
-- Additive and nullable; existing rows are unaffected. profiles / nudges /
-- weekly_digests already have RLS and the new columns are covered by it. The
-- delivery worker uses the service-role client.

alter table public.profiles
  add column if not exists email_opt_out boolean not null default false;

alter table public.nudges
  add column if not exists emailed_at timestamptz;

alter table public.weekly_digests
  add column if not exists emailed_at timestamptz;

-- Partial indexes for the "what still needs emailing" scan in the sweep.
create index if not exists nudges_unemailed_idx
  on public.nudges (created_at)
  where emailed_at is null;

create index if not exists weekly_digests_unemailed_idx
  on public.weekly_digests (created_at)
  where emailed_at is null;
