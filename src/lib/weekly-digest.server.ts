// Weekly narrative digest ("Progress"). Assembles the week's activity and turns
// it into a short, warm recap plus one small focus for the coming week, using a
// dedicated single-purpose model call (same pattern as thread-summary.server.ts).
// Nothing here touches crisis handling, screener scoring, or rate limiting.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { callCompanionModel } from "./llm-provider.server";

type Client = SupabaseClient<Database>;

const DIGEST_MODEL = "claude-sonnet-5";
const DIGEST_MAX_TOKENS = 600;
const DIGEST_SYSTEM = `You write a short weekly recap for someone using a mental wellness app. You are warm, plain-spoken and honest — never clinical, never a report, never relentlessly positive.

Write JSON only, with exactly two keys:
- "narrative": 4-7 sentences of plain prose. If a previous focus is given, OPEN by referencing whether it happened, the way a coach starts a session ("Last week we talked about X — looks like…"). Then reflect what actually happened this week in ordinary language, and name ONE honest pattern worth noticing. If the week was hard or thin on activity, say so kindly instead of inventing progress. No headings, no bullets, no diagnosis, no medical advice.
- "focus": one specific, small, achievable focus for the coming week, in one sentence, written to the person ("you").

Return raw JSON with no code fences.`;

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** Monday of the week containing `date`, as YYYY-MM-DD. */
export function weekStartOf(date: Date) {
  const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = copy.getUTCDay();
  copy.setUTCDate(copy.getUTCDate() - ((day + 6) % 7));
  return isoDay(copy);
}

type MoodSummary = { count: number; average: number | null; low: number | null; high: number | null; tags: string[] };
type HabitsSummary = { habit: string; completed: number; target: number }[];
type ExercisesTried = { name: string; count: number; moodDelta: number | null }[];
type ScreenerSummary = { type: string; score: number; severity: string; takenAt: string }[];
type Highlights = { label: string; avgMoodDelta: number; sampleSize: number; confidence: string }[];

/**
 * Generates this-week-just-ended digest for a user when 7+ days have passed
 * since their last one and they actually did something that week.
 */
export async function generateWeeklyDigestFor(
  supabase: Client,
  userId: string,
): Promise<{ created: boolean }> {
  const now = new Date();
  const weekStart = weekStartOf(new Date(now.getTime() - 7 * 86400000));
  const from = new Date(`${weekStart}T00:00:00.000Z`);
  const to = new Date(from.getTime() + 7 * 86400000);

  const last = await supabase
    .from("weekly_digests")
    .select("week_start, suggested_focus, created_at")
    .eq("user_id", userId)
    .order("week_start", { ascending: false })
    .limit(1)
    .maybeSingle();

  const previous = last.data ?? null;
  if (previous?.week_start === weekStart) return { created: false };
  if (previous && (now.getTime() - new Date(previous.created_at).getTime()) / 86400000 < 7) {
    return { created: false };
  }

  const [moods, habits, habitLogs, completions, screeners, insights, commitments] =
    await Promise.all([
      supabase
        .from("mood_logs")
        .select("score, tags, note, logged_at")
        .eq("user_id", userId)
        .gte("logged_at", from.toISOString())
        .lt("logged_at", to.toISOString()),
      supabase.from("habits").select("id, name, frequency_target").eq("user_id", userId),
      supabase
        .from("habit_logs")
        .select("habit_id, completed, log_date")
        .eq("user_id", userId)
        .gte("log_date", isoDay(from))
        .lt("log_date", isoDay(to)),
      supabase
        .from("exercise_completions")
        .select("exercise_id, mood_before, mood_after, completed_at")
        .eq("user_id", userId)
        .gte("completed_at", from.toISOString())
        .lt("completed_at", to.toISOString()),
      supabase
        .from("screener_responses")
        .select("screener_type, total_score, severity, taken_at")
        .eq("user_id", userId)
        .gte("taken_at", from.toISOString())
        .lt("taken_at", to.toISOString()),
      supabase
        .from("effectiveness_insights")
        .select("subject_label, avg_mood_delta, sample_size, confidence")
        .eq("user_id", userId)
        .order("avg_mood_delta", { ascending: false })
        .limit(3),
      supabase
        .from("commitments")
        .select("description, status, completed_at")
        .eq("user_id", userId)
        .gte("created_at", from.toISOString()),
    ]);

  const moodRows = moods.data ?? [];
  const habitRows = habits.data ?? [];
  const logRows = (habitLogs.data ?? []).filter((row) => row.completed);
  const completionRows = completions.data ?? [];
  const screenerRows = screeners.data ?? [];

  // No activity at all → no digest. Never fabricate one from nothing.
  if (
    moodRows.length === 0 &&
    logRows.length === 0 &&
    completionRows.length === 0 &&
    screenerRows.length === 0
  ) {
    return { created: false };
  }

  const scores = moodRows.map((row) => row.score);
  const moodSummary: MoodSummary = {
    count: moodRows.length,
    average: scores.length
      ? Math.round((scores.reduce((sum, value) => sum + value, 0) / scores.length) * 10) / 10
      : null,
    low: scores.length ? Math.min(...scores) : null,
    high: scores.length ? Math.max(...scores) : null,
    tags: [...new Set(moodRows.flatMap((row) => row.tags ?? []))].slice(0, 8),
  };

  const habitsSummary: HabitsSummary = habitRows
    .map((habit) => ({
      habit: habit.name,
      completed: logRows.filter((row) => row.habit_id === habit.id).length,
      target: habit.frequency_target,
    }))
    .filter((entry) => entry.completed > 0 || entry.target > 0);

  const exerciseIds = [...new Set(completionRows.map((row) => row.exercise_id))];
  const exerciseNames = new Map<string, string>();
  if (exerciseIds.length) {
    const { data } = await supabase.from("exercises").select("id, title").in("id", exerciseIds);
    for (const row of data ?? []) exerciseNames.set(row.id, row.title);
  }
  const exercisesTried: ExercisesTried = exerciseIds.map((id) => {
    const rows = completionRows.filter((row) => row.exercise_id === id);
    const deltas = rows
      .filter((row) => row.mood_before !== null && row.mood_after !== null)
      .map((row) => (row.mood_after as number) - (row.mood_before as number));
    return {
      name: exerciseNames.get(id) ?? "An exercise",
      count: rows.length,
      moodDelta: deltas.length
        ? Math.round((deltas.reduce((sum, value) => sum + value, 0) / deltas.length) * 10) / 10
        : null,
    };
  });

  const screenerSummary: ScreenerSummary = screenerRows.map((row) => ({
    type: row.screener_type,
    score: row.total_score,
    severity: row.severity,
    takenAt: isoDay(new Date(row.taken_at)),
  }));

  const highlights: Highlights = (insights.data ?? []).map((row) => ({
    label: row.subject_label,
    avgMoodDelta: row.avg_mood_delta,
    sampleSize: row.sample_size,
    confidence: row.confidence,
  }));

  // Did the previous focus happen? Best available signal: a commitment created
  // this week whose wording overlaps the focus, or any completed commitment.
  let followedUp: boolean | null = null;
  if (previous?.suggested_focus) {
    const done = (commitments.data ?? []).filter((row) => row.status === "done");
    followedUp = done.length > 0;
  }

  const facts = [
    `Week of ${weekStart}.`,
    moodSummary.count
      ? `Mood check-ins: ${moodSummary.count}, average ${moodSummary.average}/5 (low ${moodSummary.low}, high ${moodSummary.high})${moodSummary.tags.length ? `, tags: ${moodSummary.tags.join(", ")}` : ""}.`
      : "No mood check-ins this week.",
    habitsSummary.length
      ? `Habits: ${habitsSummary.map((entry) => `${entry.habit} ${entry.completed}/${entry.target}`).join("; ")}.`
      : "No habits tracked this week.",
    exercisesTried.length
      ? `Exercises: ${exercisesTried.map((entry) => `${entry.name} ×${entry.count}${entry.moodDelta !== null ? ` (mood change ${entry.moodDelta > 0 ? "+" : ""}${entry.moodDelta})` : ""}`).join("; ")}.`
      : "No exercises this week.",
    screenerSummary.length
      ? `Check-ins: ${screenerSummary.map((entry) => `${entry.type} ${entry.score} (${entry.severity})`).join("; ")}.`
      : "",
    highlights.length
      ? `What has tended to help: ${highlights.map((entry) => `${entry.label} (avg mood change ${entry.avgMoodDelta}, ${entry.sampleSize} samples, ${entry.confidence} confidence)`).join("; ")}.`
      : "",
    previous?.suggested_focus
      ? `Last week's suggested focus was: "${previous.suggested_focus}". Did they follow through? ${followedUp ? "Yes — at least one thing they committed to got marked done." : "Unclear — nothing they committed to was marked done."}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  let narrative = "";
  let focus: string | null = null;
  try {
    const payload = await callCompanionModel({
      model: DIGEST_MODEL,
      maxTokens: DIGEST_MAX_TOKENS,
      system: DIGEST_SYSTEM,
      messages: [{ role: "user", content: facts }],
    });
    const text = payload.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim()
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/, "")
      .trim();
    try {
      const parsed = JSON.parse(text) as { narrative?: string; focus?: string };
      narrative = (parsed.narrative ?? "").trim();
      focus = (parsed.focus ?? "").trim() || null;
    } catch {
      narrative = text;
    }
  } catch (error) {
    console.error("weekly digest generation failed", error);
    return { created: false };
  }

  if (!narrative) return { created: false };

  const { error } = await supabase.from("weekly_digests").insert({
    user_id: userId,
    week_start: weekStart,
    mood_summary: moodSummary,
    habits_summary: habitsSummary,
    exercises_tried: exercisesTried,
    screener_summary: screenerSummary.length ? screenerSummary : null,
    effectiveness_highlights: highlights,
    narrative_text: narrative.slice(0, 4000),
    suggested_focus: focus?.slice(0, 500) ?? null,
    previous_focus_followed_up: followedUp,
  });
  if (error) {
    console.error("weekly digest insert failed", error);
    return { created: false };
  }
  return { created: true };
}
