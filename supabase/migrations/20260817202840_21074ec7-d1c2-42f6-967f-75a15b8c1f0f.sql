CREATE TYPE public.support_status AS ENUM ('open','in_progress','resolved');
CREATE TYPE public.support_sender AS ENUM ('user','admin');

CREATE TABLE public.support_threads (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject text NOT NULL,
  status public.support_status NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.support_threads TO authenticated;
GRANT ALL ON public.support_threads TO service_role;
ALTER TABLE public.support_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own support threads" ON public.support_threads
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));
CREATE POLICY "Users create own support threads" ON public.support_threads
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins update support threads" ON public.support_threads
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE TRIGGER support_threads_updated_at BEFORE UPDATE ON public.support_threads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.support_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  thread_id uuid NOT NULL REFERENCES public.support_threads(id) ON DELETE CASCADE,
  sender public.support_sender NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.support_messages TO authenticated;
GRANT ALL ON public.support_messages TO service_role;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;

CREATE INDEX support_messages_thread_idx ON public.support_messages (thread_id, created_at);

CREATE POLICY "Users read own support messages" ON public.support_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.support_threads t WHERE t.id = thread_id AND t.user_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')
  );
CREATE POLICY "Users write own support messages" ON public.support_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender = 'user'
    AND EXISTS (SELECT 1 FROM public.support_threads t WHERE t.id = thread_id AND t.user_id = auth.uid())
  );
CREATE POLICY "Admins reply to support messages" ON public.support_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender = 'admin'
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  );