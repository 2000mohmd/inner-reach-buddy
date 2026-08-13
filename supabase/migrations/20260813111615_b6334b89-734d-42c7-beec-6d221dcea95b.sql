CREATE TABLE public.weekly_digests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  week_start DATE NOT NULL,
  mood_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  habits_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  exercises_tried JSONB NOT NULL DEFAULT '[]'::jsonb,
  screener_summary JSONB,
  effectiveness_highlights JSONB NOT NULL DEFAULT '[]'::jsonb,
  narrative_text TEXT NOT NULL,
  suggested_focus TEXT,
  previous_focus_followed_up BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, week_start)
);

GRANT SELECT ON public.weekly_digests TO authenticated;
GRANT ALL ON public.weekly_digests TO service_role;

ALTER TABLE public.weekly_digests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own digests"
ON public.weekly_digests FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE INDEX weekly_digests_user_week_idx ON public.weekly_digests (user_id, week_start DESC);