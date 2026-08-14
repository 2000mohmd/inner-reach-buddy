ALTER TABLE public.crisis_events
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS notes text;

CREATE POLICY "Admins can view all crisis events"
ON public.crisis_events FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update crisis events"
ON public.crisis_events FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.notification_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_type text NOT NULL,
  target_user_id uuid,
  subject_user_id uuid,
  title text NOT NULL,
  body text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.notification_queue TO authenticated;
GRANT ALL ON public.notification_queue TO service_role;

ALTER TABLE public.notification_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view queued notifications"
ON public.notification_queue FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can view their own notifications"
ON public.notification_queue FOR SELECT TO authenticated
USING (auth.uid() = target_user_id);

CREATE OR REPLACE FUNCTION public.queue_crisis_admin_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notification_queue (notification_type, subject_user_id, title, body, payload)
  VALUES (
    'admin_alert',
    NEW.user_id,
    'Crisis event needs review',
    'A crisis event was flagged (source: ' || NEW.source || ', severity: ' || NEW.severity || ').',
    jsonb_build_object('crisis_event_id', NEW.id, 'source', NEW.source, 'severity', NEW.severity)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS crisis_events_queue_admin_alert ON public.crisis_events;
CREATE TRIGGER crisis_events_queue_admin_alert
AFTER INSERT ON public.crisis_events
FOR EACH ROW EXECUTE FUNCTION public.queue_crisis_admin_alert();