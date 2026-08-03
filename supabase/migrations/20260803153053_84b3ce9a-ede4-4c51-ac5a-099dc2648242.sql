CREATE TABLE public.thread_summaries (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  thread_id uuid NOT NULL REFERENCES public.chat_threads(id) ON DELETE CASCADE,
  summary_text text NOT NULL,
  open_commitment_ids uuid[],
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX thread_summaries_thread_id_key ON public.thread_summaries(thread_id);
CREATE INDEX thread_summaries_user_created_idx ON public.thread_summaries(user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.thread_summaries TO authenticated;
GRANT ALL ON public.thread_summaries TO service_role;

ALTER TABLE public.thread_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own thread summaries"
ON public.thread_summaries FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);