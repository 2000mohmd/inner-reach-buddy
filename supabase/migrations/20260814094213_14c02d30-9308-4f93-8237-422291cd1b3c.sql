ALTER TABLE public.effectiveness_insights
  DROP CONSTRAINT IF EXISTS effectiveness_insights_subject_type_check;
ALTER TABLE public.effectiveness_insights
  ADD CONSTRAINT effectiveness_insights_subject_type_check
  CHECK (subject_type = ANY (ARRAY['exercise'::text, 'exercise_category'::text, 'habit'::text]));