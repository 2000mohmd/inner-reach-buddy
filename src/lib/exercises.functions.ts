import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const CompleteInput = z.object({
  exercise_id: z.string().uuid(),
  mood_before: z.number().int().min(1).max(5).nullish(),
  mood_after: z.number().int().min(1).max(5).nullish(),
  response_data: z.record(z.string(), z.union([z.string(), z.number()])).default({}),
  log_mood_after: z.boolean().default(true),
  /** When completed from an inline chat widget, keep it in that thread. */
  thread_id: z.string().uuid().nullish(),
});


export const listExercises = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [profile, exercises, completions] = await Promise.all([
      supabase.from("profiles").select("account_type").eq("id", userId).maybeSingle(),
      supabase
        .from("exercises")
        .select("id, slug, title, category, age_mode, intro_text, steps, estimated_minutes")
        .order("sort_order", { ascending: true }),
      supabase
        .from("exercise_completions")
        .select("id, exercise_id, mood_before, mood_after, response_data, completed_at")
        .eq("user_id", userId)
        .order("completed_at", { ascending: false })
        .limit(30),
    ]);
    if (exercises.error) throw exercises.error;
    if (completions.error) throw completions.error;

    const isTeen = profile.data?.account_type === "teen";
    const filtered = (exercises.data ?? []).filter((exercise) =>
      isTeen ? exercise.age_mode === "teen" : exercise.age_mode === "general",
    );

    return { exercises: filtered, completions: completions.data ?? [] };
  });

export const completeExercise = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CompleteInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const saved = await supabase
      .from("exercise_completions")
      .insert({
        user_id: userId,
        exercise_id: data.exercise_id,
        mood_before: data.mood_before ?? null,
        mood_after: data.mood_after ?? null,
        response_data: data.response_data,
      })
      .select("id, completed_at")
      .single();
    if (saved.error) throw saved.error;

    // The optional mood_after check feeds back into the mood trend.
    if (data.log_mood_after && typeof data.mood_after === "number") {
      const logged = await supabase.from("mood_logs").insert({
        user_id: userId,
        score: data.mood_after,
        tags: ["exercise"],
        is_baseline: false,
      });
      if (logged.error) console.error("mood log after exercise failed", logged.error);
    }

    return { ok: true, id: saved.data.id };
  });
