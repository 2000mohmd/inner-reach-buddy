ALTER TABLE public.crisis_events
  ADD COLUMN IF NOT EXISTS alert_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS escalation_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS escalation_count integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS crisis_events_unreviewed_idx
  ON public.crisis_events (reviewed, created_at DESC);
