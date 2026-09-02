-- Phase 3: the companion follows through.
--
-- 3a. Commitment follow-up nudge. The nudge engine already creates at most one
--     nudge per trigger_type on a 7-day cooldown; this widens the trigger_type
--     CHECK so it can also surface a due / overdue pending commitment at the
--     person's next check-in.
--
-- 3b. Post-crisis follow-up. A crisis flag currently surfaces resources + an
--     admin alert and then nothing. These two stamps let a gentle IN-APP
--     check-in fire exactly once, ~24h later, and record when it was
--     deliberately skipped (the person was already active since the event).

alter table public.nudges drop constraint if exists nudges_trigger_type_check;
alter table public.nudges
  add constraint nudges_trigger_type_check
  check (
    trigger_type in (
      'low_mood_streak',
      'inactivity',
      'screener_step_up',
      'sustained_distress',
      'commitment_follow_up'
    )
  );

alter table public.crisis_events
  add column if not exists follow_up_sent_at timestamptz,
  add column if not exists follow_up_skipped_at timestamptz;

-- "which events still need a follow-up decision" — the sweep scans this.
create index if not exists crisis_events_pending_followup_idx
  on public.crisis_events (created_at)
  where follow_up_sent_at is null and follow_up_skipped_at is null;
