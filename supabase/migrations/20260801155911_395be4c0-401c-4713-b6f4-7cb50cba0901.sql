CREATE TYPE public.commitment_source AS ENUM ('chat', 'exercise');
CREATE TYPE public.commitment_status AS ENUM ('pending', 'done', 'skipped');

CREATE TABLE public.commitments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  description text NOT NULL,
  source public.commitment_source NOT NULL DEFAULT 'chat',
  thread_id uuid REFERENCES public.chat_threads(id) ON DELETE SET NULL,
  exercise_id uuid REFERENCES public.exercises(id) ON DELETE SET NULL,
  due_at timestamptz,
  status public.commitment_status NOT NULL DEFAULT 'pending',
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.commitments TO authenticated;
GRANT ALL ON public.commitments TO service_role;
ALTER TABLE public.commitments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own commitments" ON public.commitments
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX commitments_user_status_idx ON public.commitments (user_id, status, created_at DESC);

CREATE TRIGGER update_commitments_updated_at BEFORE UPDATE ON public.commitments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.effectiveness_insights (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  subject_type text NOT NULL CHECK (subject_type IN ('exercise', 'habit')),
  subject_key text NOT NULL,
  subject_label text NOT NULL,
  sample_size smallint NOT NULL DEFAULT 0,
  avg_mood_delta numeric(4,2) NOT NULL DEFAULT 0,
  confidence text NOT NULL DEFAULT 'low' CHECK (confidence IN ('low', 'medium', 'high')),
  computed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, subject_type, subject_key)
);

GRANT SELECT ON public.effectiveness_insights TO authenticated;
GRANT ALL ON public.effectiveness_insights TO service_role;
ALTER TABLE public.effectiveness_insights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own effectiveness insights" ON public.effectiveness_insights
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE INDEX effectiveness_insights_user_idx
  ON public.effectiveness_insights (user_id, avg_mood_delta DESC);

CREATE TRIGGER update_effectiveness_insights_updated_at BEFORE UPDATE ON public.effectiveness_insights
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();