ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS content_type TEXT NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS exercise_slug TEXT;

CREATE TABLE public.daily_prompts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  prompt_text TEXT NOT NULL,
  prompt_type TEXT NOT NULL DEFAULT 'reflection',
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
GRANT SELECT ON public.daily_prompts TO authenticated;
GRANT ALL ON public.daily_prompts TO service_role;
ALTER TABLE public.daily_prompts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed in users read active daily prompts" ON public.daily_prompts
  FOR SELECT TO authenticated USING (active);

CREATE TABLE public.daily_prompt_responses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  prompt_id UUID NOT NULL REFERENCES public.daily_prompts(id) ON DELETE CASCADE,
  response_text TEXT NOT NULL,
  responded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_prompt_responses TO authenticated;
GRANT ALL ON public.daily_prompt_responses TO service_role;
ALTER TABLE public.daily_prompt_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own daily prompt responses" ON public.daily_prompt_responses
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX daily_prompt_responses_user_day_idx
  ON public.daily_prompt_responses (user_id, responded_at DESC);

INSERT INTO public.daily_prompts (prompt_text, prompt_type, sort_order) VALUES
  ('What''s one small thing that went okay today?', 'gratitude', 1),
  ('What''s one thing you''re looking forward to?', 'intention', 2),
  ('Who came to mind today, and why?', 'reflection', 3),
  ('What would make tomorrow feel a little lighter?', 'intention', 4),
  ('What''s something you did today that took effort, even a little?', 'reflection', 5),
  ('What''s one thing you''re glad you have right now?', 'gratitude', 6),
  ('If today had a title, what would it be?', 'reflection', 7);