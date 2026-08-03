// "Your data" summary + a plain-text report a person can hand to a therapist.
// Read-only: this never modifies or deletes anything.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SCREENERS, maxScore, type ScreenerType } from "./screeners";

function range(dates: string[]): { first: string | null; last: string | null } {
  if (dates.length === 0) return { first: null, last: null };
  const sorted = [...dates].sort();
  return { first: sorted[0] ?? null, last: sorted[sorted.length - 1] ?? null };
}

function day(value: string) {
  return new Date(value).toISOString().slice(0, 10);
}

export const getMyDataSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const [moods, habitLogs, screeners, summaries, completions, commitments] = await Promise.all([
      supabase.from("mood_logs").select("logged_at").eq("user_id", userId),
      supabase.from("habit_logs").select("log_date").eq("user_id", userId),
      supabase.from("screener_responses").select("taken_at").eq("user_id", userId),
      supabase.from("thread_summaries").select("created_at").eq("user_id", userId),
      supabase.from("exercise_completions").select("completed_at").eq("user_id", userId),
      supabase.from("commitments").select("created_at, status").eq("user_id", userId),
    ]);

    const items = [
      {
        key: "mood_logs",
        label: "Mood check-ins",
        description: "How you rated your mood, plus any note and tags you added.",
        count: moods.data?.length ?? 0,
        ...range((moods.data ?? []).map((row) => day(row.logged_at))),
      },
      {
        key: "habit_logs",
        label: "Habit logs",
        description: "Which habits you ticked off on which days.",
        count: habitLogs.data?.length ?? 0,
        ...range((habitLogs.data ?? []).map((row) => row.log_date)),
      },
      {
        key: "screener_responses",
        label: "Check-in history (PHQ-9 / GAD-7)",
        description: "Your answers, total scores and severity bands over time.",
        count: screeners.data?.length ?? 0,
        ...range((screeners.data ?? []).map((row) => day(row.taken_at))),
      },
      {
        key: "thread_summaries",
        label: "Conversation summaries",
        description:
          "Short notes the companion keeps so it can remember past conversations with you.",
        count: summaries.data?.length ?? 0,
        ...range((summaries.data ?? []).map((row) => day(row.created_at))),
      },
      {
        key: "exercise_completions",
        label: "Exercises completed",
        description: "Which exercises you finished, and your mood before and after.",
        count: completions.data?.length ?? 0,
        ...range((completions.data ?? []).map((row) => day(row.completed_at))),
      },
      {
        key: "commitments",
        label: "Commitments",
        description: "Small things you said you'd try, and whether you marked them done.",
        count: commitments.data?.length ?? 0,
        ...range((commitments.data ?? []).map((row) => day(row.created_at))),
      },
    ];

    return { items };
  });

export const buildMyReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const [profile, moods, screeners, completions] = await Promise.all([
      supabase.from("profiles").select("preferred_name").eq("id", userId).maybeSingle(),
      supabase
        .from("mood_logs")
        .select("score, note, tags, logged_at")
        .eq("user_id", userId)
        .order("logged_at", { ascending: false })
        .limit(90),
      supabase
        .from("screener_responses")
        .select("screener_type, total_score, severity, taken_at")
        .eq("user_id", userId)
        .order("taken_at", { ascending: false })
        .limit(40),
      supabase
        .from("exercise_completions")
        .select("mood_before, mood_after, completed_at, exercises(title)")
        .eq("user_id", userId)
        .order("completed_at", { ascending: false })
        .limit(50),
    ]);

    const moodRows = moods.data ?? [];
    const average =
      moodRows.length > 0
        ? (moodRows.reduce((total, row) => total + row.score, 0) / moodRows.length).toFixed(1)
        : null;

    const lines: string[] = [
      "KALM WELLNESS REPORT",
      `Prepared for: ${profile.data?.preferred_name ?? "you"}`,
      `Generated: ${new Date().toLocaleString()}`,
      "",
      "This is a self-tracking summary from a wellness support app. It is not a clinical assessment or diagnosis.",
      "",
      "MOOD TREND",
      moodRows.length === 0
        ? "No mood check-ins logged."
        : `${moodRows.length} check-ins, average ${average} of 5 (1 = really low, 5 = great).`,
    ];

    for (const row of moodRows) {
      const extras = [row.tags.join("/"), row.note].filter(Boolean).join(" — ");
      lines.push(`  ${day(row.logged_at)}  ${row.score}/5${extras ? `  ${extras}` : ""}`);
    }

    lines.push("", "CHECK-IN HISTORY (PHQ-9 / GAD-7)");
    const screenerRows = screeners.data ?? [];
    if (screenerRows.length === 0) {
      lines.push("No questionnaires completed.");
    } else {
      for (const row of screenerRows) {
        const type = row.screener_type as ScreenerType;
        const label = SCREENERS[type]?.label ?? row.screener_type;
        const max = SCREENERS[type] ? maxScore(type) : null;
        lines.push(
          `  ${day(row.taken_at)}  ${label}: ${row.total_score}${max ? ` of ${max}` : ""} (${row.severity} range)`,
        );
      }
      lines.push(
        "  Severity bands are the instruments' standard cut-points; they indicate symptom load, not a diagnosis.",
      );
    }

    lines.push("", "EXERCISES COMPLETED");
    const exerciseRows = completions.data ?? [];
    if (exerciseRows.length === 0) {
      lines.push("No exercises completed.");
    } else {
      for (const row of exerciseRows) {
        const title =
          (row as { exercises?: { title?: string } | null }).exercises?.title ?? "Exercise";
        const shift =
          typeof row.mood_before === "number" && typeof row.mood_after === "number"
            ? `  mood ${row.mood_before} → ${row.mood_after}`
            : "";
        lines.push(`  ${day(row.completed_at)}  ${title}${shift}`);
      }
    }

    lines.push(
      "",
      "If anything here is concerning, please talk to a qualified professional. In an emergency, contact local emergency services or a crisis line.",
    );

    return {
      filename: `kalm-report-${new Date().toISOString().slice(0, 10)}.txt`,
      content: lines.join("\n"),
    };
  });
