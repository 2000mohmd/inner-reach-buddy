// Effectiveness computation: turns raw completions/logs into the
// effectiveness_insights rows the companion reads before suggesting anything.
// Deliberately simple bucketed confidence — this is pattern surfacing, not
// statistics. Nothing here touches chat or crisis code.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Client = SupabaseClient<Database>;

const MIN_SAMPLES = 3;
const HABIT_WINDOW_DAYS = 60;

export function confidenceFor(sampleSize: number): "low" | "medium" | "high" {
  if (sampleSize >= 15) return "high";
  if (sampleSize >= 6) return "medium";
  return "low";
}

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

function categoryLabel(category: string) {
  return category
    .split(/[_\s-]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

type InsightRow = {
  user_id: string;
  subject_type: string;
  subject_key: string;
  subject_label: string;
  sample_size: number;
  avg_mood_delta: number;
  confidence: string;
  computed_at: string;
};

/** avg(mood_after - mood_before) per exercise category. */
async function computeExerciseCategoryInsights(
  supabase: Client,
  userId: string,
): Promise<InsightRow[]> {
  const { data, error } = await supabase
    .from("exercise_completions")
    .select("mood_before, mood_after, exercises(category)")
    .eq("user_id", userId)
    .not("mood_before", "is", null)
    .not("mood_after", "is", null);
  if (error) throw error;

  const byCategory = new Map<string, number[]>();
  for (const row of data ?? []) {
    const category = (row.exercises as { category: string } | null)?.category;
    if (!category || row.mood_before == null || row.mood_after == null) continue;
    const list = byCategory.get(category) ?? [];
    list.push(row.mood_after - row.mood_before);
    byCategory.set(category, list);
  }

  const now = new Date().toISOString();
  const rows: InsightRow[] = [];
  for (const [category, deltas] of byCategory) {
    if (deltas.length < MIN_SAMPLES) continue;
    rows.push({
      user_id: userId,
      subject_type: "exercise_category",
      subject_key: category,
      subject_label: categoryLabel(category),
      sample_size: deltas.length,
      avg_mood_delta: Number(average(deltas).toFixed(2)),
      confidence: confidenceFor(deltas.length),
      computed_at: now,
    });
  }
  return rows;
}

/**
 * Per habit: average next-day mood on days after the habit was completed vs.
 * days it wasn't, over the last ~60 days. The delta is (after-completion mean −
 * after-skip mean), so a positive number means the habit tends to precede
 * better days for this person.
 */
async function computeHabitInsights(supabase: Client, userId: string): Promise<InsightRow[]> {
  const since = daysAgo(HABIT_WINDOW_DAYS);

  const [habits, logs, moods] = await Promise.all([
    supabase.from("habits").select("id, name").eq("user_id", userId),
    supabase
      .from("habit_logs")
      .select("habit_id, log_date, completed")
      .eq("user_id", userId)
      .gte("log_date", isoDay(since)),
    supabase
      .from("mood_logs")
      .select("score, logged_at")
      .eq("user_id", userId)
      .gte("logged_at", since.toISOString()),
  ]);
  if (habits.error) throw habits.error;
  if (logs.error) throw logs.error;
  if (moods.error) throw moods.error;

  // Average mood per calendar day.
  const moodByDay = new Map<string, number[]>();
  for (const mood of moods.data ?? []) {
    const day = mood.logged_at.slice(0, 10);
    const list = moodByDay.get(day) ?? [];
    list.push(mood.score);
    moodByDay.set(day, list);
  }
  const dayMood = new Map<string, number>();
  for (const [day, scores] of moodByDay) dayMood.set(day, average(scores));

  const nextDay = (day: string) => {
    const date = new Date(`${day}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    return isoDay(date);
  };

  const now = new Date().toISOString();
  const rows: InsightRow[] = [];

  for (const habit of habits.data ?? []) {
    const habitLogs = (logs.data ?? []).filter((log) => log.habit_id === habit.id);
    const done: number[] = [];
    const skipped: number[] = [];

    for (const log of habitLogs) {
      const score = dayMood.get(nextDay(log.log_date));
      if (score == null) continue;
      (log.completed ? done : skipped).push(score);
    }

    // Sample size is the number of completed days we could pair with a mood.
    if (done.length < MIN_SAMPLES) continue;
    const baseline = skipped.length ? average(skipped) : null;
    // With no skipped-day comparison, fall back to the person's overall mood.
    const allScores = [...dayMood.values()];
    const reference = baseline ?? (allScores.length ? average(allScores) : null);
    if (reference == null) continue;

    rows.push({
      user_id: userId,
      subject_type: "habit",
      subject_key: habit.id,
      subject_label: habit.name,
      sample_size: done.length,
      avg_mood_delta: Number((average(done) - reference).toFixed(2)),
      confidence: confidenceFor(done.length),
      computed_at: now,
    });
  }

  return rows;
}

/** Recomputes and upserts all insight rows for one user. */
export async function computeEffectivenessFor(supabase: Client, userId: string) {
  const [exerciseRows, habitRows] = await Promise.all([
    computeExerciseCategoryInsights(supabase, userId),
    computeHabitInsights(supabase, userId),
  ]);
  const rows = [...exerciseRows, ...habitRows];
  if (!rows.length) return { written: 0 };

  const { error } = await supabase
    .from("effectiveness_insights")
    .upsert(rows, { onConflict: "user_id,subject_type,subject_key" });
  if (error) throw error;

  return { written: rows.length };
}

/**
 * Cheap gate for the sweep: only recompute when the person has logged something
 * newer than their last computation.
 */
export async function hasNewActivitySince(supabase: Client, userId: string): Promise<boolean> {
  const last = await supabase
    .from("effectiveness_insights")
    .select("computed_at")
    .eq("user_id", userId)
    .order("computed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (last.error) throw last.error;

  const since = last.data?.computed_at ?? null;
  if (!since) return true;

  const [completions, habitLogs, moods] = await Promise.all([
    supabase
      .from("exercise_completions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gt("created_at", since),
    supabase
      .from("habit_logs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gt("created_at", since),
    supabase
      .from("mood_logs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gt("created_at", since),
  ]);

  return Boolean((completions.count ?? 0) + (habitLogs.count ?? 0) + (moods.count ?? 0));
}
