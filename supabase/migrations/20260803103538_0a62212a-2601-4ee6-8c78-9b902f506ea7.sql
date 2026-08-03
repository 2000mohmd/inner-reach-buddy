ALTER TABLE public.crisis_events ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'chat';

CREATE TABLE IF NOT EXISTS public.chat_rate_limits (
  user_id uuid NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  window_start timestamp with time zone NOT NULL DEFAULT now(),
  count integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.chat_rate_limits TO authenticated;
GRANT ALL ON public.chat_rate_limits TO service_role;

ALTER TABLE public.chat_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own rate limit" ON public.chat_rate_limits
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER chat_rate_limits_updated_at BEFORE UPDATE ON public.chat_rate_limits
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();