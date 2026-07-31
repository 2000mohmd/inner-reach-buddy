CREATE TABLE public.exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  category text NOT NULL CHECK (category IN ('thought_record','behavioral_activation','grounding','breathing','journaling')),
  age_mode text NOT NULL DEFAULT 'general' CHECK (age_mode IN ('general','teen')),
  intro_text text NOT NULL,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  estimated_minutes smallint NOT NULL DEFAULT 5,
  sort_order smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.exercises TO authenticated;
GRANT ALL ON public.exercises TO service_role;
ALTER TABLE public.exercises ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed in users read exercises" ON public.exercises FOR SELECT TO authenticated USING (true);
CREATE TRIGGER update_exercises_updated_at BEFORE UPDATE ON public.exercises FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.exercise_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  exercise_id uuid NOT NULL REFERENCES public.exercises(id) ON DELETE CASCADE,
  mood_before smallint,
  mood_after smallint,
  response_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  completed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exercise_completions TO authenticated;
GRANT ALL ON public.exercise_completions TO service_role;
ALTER TABLE public.exercise_completions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own exercise completions" ON public.exercise_completions FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX exercise_completions_user_idx ON public.exercise_completions (user_id, completed_at DESC);

CREATE TABLE public.screener_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  screener_type text NOT NULL CHECK (screener_type IN ('phq9','gad7')),
  responses jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_score smallint NOT NULL,
  severity text NOT NULL,
  taken_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.screener_responses TO authenticated;
GRANT ALL ON public.screener_responses TO service_role;
ALTER TABLE public.screener_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own screener responses" ON public.screener_responses FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX screener_responses_user_idx ON public.screener_responses (user_id, screener_type, taken_at DESC);

CREATE TABLE public.nudges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  trigger_type text NOT NULL CHECK (trigger_type IN ('low_mood_streak','inactivity','screener_step_up','sustained_distress')),
  message text NOT NULL,
  suggested_exercise_slug text,
  resource_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  dismissed_at timestamptz,
  acted_on boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nudges TO authenticated;
GRANT ALL ON public.nudges TO service_role;
ALTER TABLE public.nudges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own nudges" ON public.nudges FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX nudges_user_idx ON public.nudges (user_id, trigger_type, created_at DESC);

CREATE TABLE public.care_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_type text NOT NULL CHECK (resource_type IN ('directory','low_cost','employer_eap','crisis')),
  name text NOT NULL,
  description text NOT NULL,
  contact_or_url text NOT NULL,
  region text,
  org_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  sort_order smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.care_resources TO authenticated;
GRANT SELECT ON public.care_resources TO anon;
GRANT ALL ON public.care_resources TO service_role;
ALTER TABLE public.care_resources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone reads active care resources" ON public.care_resources FOR SELECT USING (is_active);
CREATE TRIGGER update_care_resources_updated_at BEFORE UPDATE ON public.care_resources FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.care_resources (resource_type, name, description, contact_or_url, region, sort_order) VALUES
('directory','Psychology Today therapist directory','Search licensed therapists by location, specialty, insurance and sliding-scale availability.','https://www.psychologytoday.com/us/therapists','US',1),
('low_cost','Open Path Psychotherapy Collective','Sessions at $40-$80 with vetted therapists for people without adequate insurance.','https://openpathcollective.org','US',2),
('crisis','988 Suicide & Crisis Lifeline','Free, confidential support 24/7 if things feel unsafe or overwhelming.','Call or text 988','US',3),
('crisis','Crisis Text Line','Text with a trained crisis counselor any time, 24/7.','Text HOME to 741741','US',4),
('crisis','Find a Helpline (international)','Free helplines in almost every country.','https://findahelpline.com',NULL,5),
('employer_eap','Employee Assistance Program','Many employers offer free, confidential counselling sessions. This will be filled in with your organisation''s details when workplace support is enabled.','Ask your HR or benefits contact',NULL,6);

INSERT INTO public.exercises (slug, title, category, age_mode, intro_text, estimated_minutes, sort_order, steps) VALUES
('cbt-thought-record','CBT Thought Record','thought_record','general','When a thought feels like a fact, writing it down helps you look at it instead of from inside it. Go slowly — there are no wrong answers here.',10,1,'[
 {"key":"situation","prompt":"What was the situation? Just the facts — where you were, who was there, what happened.","input":"textarea"},
 {"key":"automatic_thought","prompt":"What went through your mind? Write the thought as bluntly as it showed up.","input":"textarea"},
 {"key":"emotion","prompt":"What emotion came with it? Name it in a word or two.","input":"text"},
 {"key":"intensity_before","prompt":"How intense was that emotion, 1 to 10?","input":"scale_1_10"},
 {"key":"evidence_for","prompt":"What evidence supports the thought? What makes it feel true?","input":"textarea"},
 {"key":"evidence_against","prompt":"What evidence does not fit the thought? Anything it leaves out, exaggerates, or predicts without proof.","input":"textarea"},
 {"key":"balanced_thought","prompt":"Given both columns, what is a more balanced thought? Not forced positivity — something you could actually believe.","input":"textarea"},
 {"key":"intensity_after","prompt":"Re-rate the emotion now, 1 to 10.","input":"scale_1_10"}
]'::jsonb),
('behavioral-activation','Behavioral Activation','behavioral_activation','general','When mood drops, we withdraw — and withdrawing lowers mood further. This breaks that loop with one small action, chosen by you, small enough that it is almost boring.',5,2,'[
 {"key":"noticing","prompt":"What have you been doing less of lately that used to matter to you, even slightly?","input":"textarea"},
 {"key":"activity","prompt":"Name ONE small, concrete activity you could do in the next 24 hours. Specific and low-effort: \"walk to the mailbox\", \"text one friend\", \"open the curtains and sit by the window\" — not \"exercise more\".","input":"text"},
 {"key":"when","prompt":"When exactly will you do it? Day and rough time.","input":"text"},
 {"key":"obstacle","prompt":"What might get in the way, and what is your smaller backup version of the activity?","input":"textarea"},
 {"key":"prediction","prompt":"How do you expect to feel afterwards, 1 to 10? We will check the actual result next time.","input":"scale_1_10"}
]'::jsonb),
('grounding-54321','5-4-3-2-1 Grounding','grounding','general','This pulls attention out of the spiral and back into the room, one sense at a time. Take it at your own pace.',4,3,'[
 {"key":"see","prompt":"Look around and name 5 things you can see.","input":"textarea","timer_seconds":45},
 {"key":"feel","prompt":"Name 4 things you can physically feel — fabric, temperature, the chair, your feet.","input":"textarea","timer_seconds":40},
 {"key":"hear","prompt":"Name 3 things you can hear right now.","input":"textarea","timer_seconds":30},
 {"key":"smell","prompt":"Name 2 things you can smell, or two smells you like.","input":"textarea","timer_seconds":25},
 {"key":"taste","prompt":"Name 1 thing you can taste, or one taste you would welcome.","input":"text","timer_seconds":20},
 {"key":"after","prompt":"Anything you notice in your body now compared to when you started? (optional)","input":"textarea"}
]'::jsonb),
('box-breathing','Box Breathing (4-4-4-4)','breathing','general','Four equal counts, four sides of a box. Slowing the out-breath is what tells your nervous system it is safe to settle.',3,4,'[
 {"key":"settle","prompt":"Sit or lie somewhere supported. Let your shoulders drop.","input":"none","timer_seconds":15},
 {"key":"inhale","prompt":"Breathe in gently through your nose for a count of 4.","input":"none","timer_seconds":4},
 {"key":"hold_in","prompt":"Hold for a count of 4. Keep it easy — no straining.","input":"none","timer_seconds":4},
 {"key":"exhale","prompt":"Breathe out slowly through your mouth for a count of 4.","input":"none","timer_seconds":4},
 {"key":"hold_out","prompt":"Hold empty for a count of 4. Then repeat the box 4 more times.","input":"none","timer_seconds":4},
 {"key":"after","prompt":"How does your body feel now? (optional)","input":"textarea"}
]'::jsonb),
('worry-time','Worry Time Journaling','journaling','general','Worry does not need to be argued with all day — it needs a container. Park the worry here, with a time to come back to it.',6,5,'[
 {"key":"worry","prompt":"What is the worry, in one or two sentences?","input":"textarea"},
 {"key":"controllable","prompt":"Is there anything about this that is actually in your control today? If yes, what is the single next step?","input":"textarea"},
 {"key":"revisit_at","prompt":"When will you come back to this worry? Pick a specific day and time — 15 minutes is plenty.","input":"text"},
 {"key":"park","prompt":"Write the sentence you will use when it comes back before then. For example: \"Not now — I have time set aside for you at 6pm.\"","input":"text"}
]'::jsonb),
('teen-grounding-54321','5-4-3-2-1 Grounding','grounding','teen','When your head is loud, this brings you back to the room one sense at a time. No one has to know you are doing it.',4,6,'[
 {"key":"see","prompt":"Name 5 things you can see around you right now.","input":"textarea","timer_seconds":45},
 {"key":"feel","prompt":"Name 4 things you can feel — your hoodie, the desk, your feet on the floor.","input":"textarea","timer_seconds":40},
 {"key":"hear","prompt":"Name 3 sounds you can hear.","input":"textarea","timer_seconds":30},
 {"key":"smell","prompt":"Name 2 smells, or 2 you like.","input":"textarea","timer_seconds":25},
 {"key":"taste","prompt":"Name 1 taste.","input":"text","timer_seconds":20}
]'::jsonb),
('teen-thought-check','Thought Check','thought_record','teen','Thoughts can feel like facts, especially the mean ones. This is a quick way to check one instead of believing it straight away.',7,7,'[
 {"key":"situation","prompt":"What happened? Just what you would tell a friend.","input":"textarea"},
 {"key":"automatic_thought","prompt":"What did your brain say about it?","input":"textarea"},
 {"key":"emotion","prompt":"What feeling came with that?","input":"text"},
 {"key":"intensity_before","prompt":"How strong was it, 1 to 10?","input":"scale_1_10"},
 {"key":"evidence_for","prompt":"What makes that thought feel true?","input":"textarea"},
 {"key":"evidence_against","prompt":"What does not fit it? Anything it is skipping over?","input":"textarea"},
 {"key":"balanced_thought","prompt":"What would you say to a friend who had this thought?","input":"textarea"},
 {"key":"intensity_after","prompt":"How strong is the feeling now, 1 to 10?","input":"scale_1_10"}
]'::jsonb);
