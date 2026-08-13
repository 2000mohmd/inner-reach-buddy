import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** The person's weekly Progress recaps, newest first. */
export const listWeeklyDigests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("weekly_digests")
      .select(
        "id, week_start, narrative_text, suggested_focus, previous_focus_followed_up, mood_summary, habits_summary, exercises_tried, screener_summary, effectiveness_highlights, created_at",
      )
      .eq("user_id", context.userId)
      .order("week_start", { ascending: false })
      .limit(26);
    if (error) throw new Error(error.message);
    return { digests: data ?? [] };
  });
