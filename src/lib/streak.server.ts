// Consecutive-day engagement streak. Purely for a warm, once-in-a-while
// acknowledgement in conversation — no badges, no scores, no gamification.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Client = SupabaseClient<Database>;

function dayKey(iso: string) {
  return iso.slice(0, 10);
}

/** Counts consecutive days (ending today or yesterday) with any engagement. */
export async function computeEngagementStreak(
  supabase: Client,
  userId: string,
): Promise<number> {
  const since = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();

  const [moods, prompts, completions] = await Promise.all([
    supabase.from("mood_logs").select("logged_at").eq("user_id", userId).gte("logged_at", since),
    supabase
      .from("daily_prompt_responses")
      .select("responded_at")
      .eq("user_id", userId)
      .gte("responded_at", since),
    supabase
      .from("exercise_completions")
      .select("completed_at")
      .eq("user_id", userId)
      .gte("completed_at", since),
  ]);

  const days = new Set<string>();
  for (const row of moods.data ?? []) days.add(dayKey(row.logged_at));
  for (const row of prompts.data ?? []) days.add(dayKey(row.responded_at));
  for (const row of completions.data ?? []) days.add(dayKey(row.completed_at));
  if (days.size === 0) return 0;

  const today = new Date();
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  const start = new Date(today);
  if (!days.has(iso(start))) {
    start.setUTCDate(start.getUTCDate() - 1);
    if (!days.has(iso(start))) return 0;
  }

  let streak = 0;
  const cursor = new Date(start);
  while (days.has(iso(cursor))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}
