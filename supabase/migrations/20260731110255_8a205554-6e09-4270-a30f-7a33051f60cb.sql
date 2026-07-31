CREATE POLICY "Users log own crisis events" ON public.crisis_events FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
GRANT INSERT ON public.crisis_events TO authenticated;