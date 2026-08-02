// Server-side tool implementations for the Claude-powered companion.
// NOTE: none of these tools touch crisis handling. The deterministic
// detectCrisis() gate in crisis.ts runs before this file is ever reached.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Client = SupabaseClient<Database>;

/** A user-visible record of something the model actually did. */
export type CompanionAction =
  | { type: "mood_logged"; score: number; tags: string[]; summary: string }
  | { type: "commitment_created"; id: string; description: string; summary: string }
  | { type: "exercise_launch"; slug: string; title: string; minutes: number; summary: string }
  | { type: "exercise_completed"; slug: string; title: string; summary: string }
  | { type: "stepup_suggested"; summary: string };

export type ToolContext = {
  supabase: Client;
  userId: string;
  threadId: string | null;
};

export type AnthropicTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
};

const LOG_MOOD: AnthropicTool = {
  name: "log_mood",
  description:
    "Record a mood check-in for the person, on a 1-5 scale where 1 is very low and 5 is good. Only use this when the person has clearly told you how they are feeling and it makes sense to save it. Mention afterwards that you saved it.",
  input_schema: {
    type: "object",
    properties: {
      score: { type: "integer", description: "Mood from 1 (very low) to 5 (good)" },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Short lowercase themes, e.g. work, sleep, lonely",
      },
      note: { type: "string", description: "Optional short note in the person's own words" },
    },
    required: ["score"],
  },
};

const CREATE_COMMITMENT: AnthropicTool = {
  name: "create_commitment",
  description:
    "Start tracking one small, concrete thing the person has said they will try. Use only when they have named something specific and agreed to it — never to assign them homework.",
  input_schema: {
    type: "object",
    properties: {
      description: {
        type: "string",
        description: "The specific action in the person's own words, e.g. 'text Sam tomorrow'",
      },
    },
    required: ["description"],
  },
};

const GET_EFFECTIVENESS_INSIGHTS: AnthropicTool = {
  name: "get_effectiveness_insights",
  description:
    "Read what has actually helped this person before, based on their own exercise and habit history and mood changes. Use this before suggesting anything, so suggestions are grounded in their data rather than guessed.",
  input_schema: { type: "object", properties: {} },
};

const LAUNCH_EXERCISE: AnthropicTool = {
  name: "launch_exercise",
  description:
    "Hand off to a structured guided exercise in the app instead of describing the steps in prose. Valid slugs come from get_effectiveness_insights or from these: cbt-thought-record, behavioral-activation, grounding-54321, box-breathing, worry-time.",
  input_schema: {
    type: "object",
    properties: { exercise_slug: { type: "string" } },
    required: ["exercise_slug"],
  },
};

const SUGGEST_STEPUP: AnthropicTool = {
  name: "suggest_stepup",
  description:
    "Signal that this conversation suggests the person could use more support than you can offer, so the app surfaces professional care options. This is NOT for acute risk, which is handled separately before you ever see the message. Use sparingly, warmly, and never as a way to end the conversation.",
  input_schema: { type: "object", properties: {} },
};

const GET_EXERCISE_STEPS: AnthropicTool = {
  name: "get_exercise_steps",
  description:
    "Read the ordered steps of an exercise so you can walk the person through it inline, one step per message, inside the conversation. Valid slugs: cbt-thought-record, behavioral-activation, grounding-54321, box-breathing, worry-time.",
  input_schema: {
    type: "object",
    properties: { exercise_slug: { type: "string" } },
    required: ["exercise_slug"],
  },
};

const COMPLETE_EXERCISE_IN_CHAT: AnthropicTool = {
  name: "complete_exercise_in_chat",
  description:
    "Record that the person completed an exercise with you inside the conversation, so it counts the same as doing it on the Exercises page. Use only after you have actually walked them through the steps.",
  input_schema: {
    type: "object",
    properties: {
      exercise_slug: { type: "string" },
      mood_before: { type: "integer", description: "Mood 1-5 before, if known" },
      mood_after: { type: "integer", description: "Mood 1-5 after, if known" },
      response_summary: {
        type: "string",
        description: "Brief summary of what they shared during the exercise, not verbatim",
      },
    },
    required: ["exercise_slug"],
  },
};

/** Full conversational tool set. */
export const CHAT_TOOLS: AnthropicTool[] = [
  LOG_MOOD,
  CREATE_COMMITMENT,
  GET_EFFECTIVENESS_INSIGHTS,
  GET_EXERCISE_STEPS,
  COMPLETE_EXERCISE_IN_CHAT,
  LAUNCH_EXERCISE,
  SUGGEST_STEPUP,
];

/** Nudges are one-shot generations: read-only tools only. */
export const NUDGE_TOOLS: AnthropicTool[] = [GET_EFFECTIVENESS_INSIGHTS];

/**
 * Recomputes the person's effectiveness insights from their own history.
 * Uses the admin client because the table is read-only to end users.
 */
async function refreshEffectivenessInsights(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const [completions, exercises] = await Promise.all([
    supabaseAdmin
      .from("exercise_completions")
      .select("exercise_id, mood_before, mood_after")
      .eq("user_id", userId)
      .not("mood_before", "is", null)
      .not("mood_after", "is", null)
      .limit(400),
    supabaseAdmin.from("exercises").select("id, slug, title"),
  ]);

  const byExercise = new Map<string, number[]>();
  for (const row of completions.data ?? []) {
    const delta = (row.mood_after ?? 0) - (row.mood_before ?? 0);
    byExercise.set(row.exercise_id, [...(byExercise.get(row.exercise_id) ?? []), delta]);
  }
  if (byExercise.size === 0) return;

  const meta = new Map((exercises.data ?? []).map((row) => [row.id, row]));
  const rows = [...byExercise.entries()].flatMap(([exerciseId, deltas]) => {
    const info = meta.get(exerciseId);
    if (!info) return [];
    const average = deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
    return [
      {
        user_id: userId,
        subject_type: "exercise",
        subject_key: info.slug,
        subject_label: info.title,
        sample_size: deltas.length,
        avg_mood_delta: Number(average.toFixed(2)),
        confidence: deltas.length >= 5 ? "high" : deltas.length >= 3 ? "medium" : "low",
        computed_at: new Date().toISOString(),
      },
    ];
  });
  if (rows.length === 0) return;

  const { error } = await supabaseAdmin
    .from("effectiveness_insights")
    .upsert(rows, { onConflict: "user_id,subject_type,subject_key" });
  if (error) console.error("effectiveness insight upsert failed", error);
}

export type ToolOutcome = { result: string; action?: CompanionAction };

/** Executes one tool call and returns text for the model plus an optional user-visible action. */
export async function runCompanionTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const { supabase, userId } = ctx;

  if (name === "log_mood") {
    const raw = Number(input["score"]);
    const score = Math.min(5, Math.max(1, Math.round(Number.isFinite(raw) ? raw : 3)));
    const tags = Array.isArray(input["tags"])
      ? (input["tags"] as unknown[]).map((tag) => String(tag).slice(0, 40)).slice(0, 10)
      : [];
    const note = typeof input["note"] === "string" ? input["note"].slice(0, 500) : null;

    const { error } = await supabase.from("mood_logs").insert({
      user_id: userId,
      score,
      note,
      tags,
      is_baseline: false,
    });
    if (error) return { result: `Could not save the mood check-in: ${error.message}` };

    return {
      result: `Saved a mood check-in of ${score}/5${tags.length ? ` tagged ${tags.join(", ")}` : ""}.`,
      action: {
        type: "mood_logged",
        score,
        tags,
        summary: `Logged your mood as ${score}/5${tags.length ? ` (${tags.join(", ")})` : ""}.`,
      },
    };
  }

  if (name === "create_commitment") {
    const description = String(input["description"] ?? "").trim().slice(0, 300);
    if (!description) return { result: "No commitment description was provided." };

    const { data, error } = await supabase
      .from("commitments")
      .insert({
        user_id: userId,
        description,
        source: "chat",
        thread_id: ctx.threadId,
      })
      .select("id, description")
      .single();
    if (error) return { result: `Could not save the commitment: ${error.message}` };

    return {
      result: `Now tracking the commitment: "${data.description}".`,
      action: {
        type: "commitment_created",
        id: data.id,
        description: data.description,
        summary: `Started tracking: "${data.description}".`,
      },
    };
  }

  if (name === "get_effectiveness_insights") {
    await refreshEffectivenessInsights(userId).catch((error) =>
      console.error("insight refresh failed", error),
    );
    const { data, error } = await supabase
      .from("effectiveness_insights")
      .select("subject_type, subject_key, subject_label, sample_size, avg_mood_delta, confidence")
      .eq("user_id", userId)
      .order("avg_mood_delta", { ascending: false })
      .limit(5);
    if (error) return { result: `Could not read insights: ${error.message}` };
    if (!data || data.length === 0) {
      return {
        result:
          "No effectiveness data yet — this person hasn't completed enough exercises with before/after mood for patterns to show. Do not claim to know what works for them.",
      };
    }
    return {
      result: data
        .map(
          (row) =>
            `${row.subject_label} (slug: ${row.subject_key}) — average mood change ${row.avg_mood_delta > 0 ? "+" : ""}${row.avg_mood_delta} across ${row.sample_size} completions, confidence ${row.confidence}`,
        )
        .join("\n"),
    };
  }

  if (name === "launch_exercise") {
    const slug = String(input["exercise_slug"] ?? "").trim();
    const { data, error } = await supabase
      .from("exercises")
      .select("slug, title, intro_text, estimated_minutes, category")
      .eq("slug", slug)
      .maybeSingle();
    if (error) return { result: `Could not look up that exercise: ${error.message}` };
    if (!data) return { result: `No exercise exists with slug "${slug}". Do not offer it.` };

    return {
      result: `Exercise available: ${data.title} (${data.estimated_minutes} min, ${data.category}). ${data.intro_text} The app is showing the person a button to open it, so invite them into it briefly instead of listing the steps.`,
      action: {
        type: "exercise_launch",
        slug: data.slug,
        title: data.title,
        minutes: data.estimated_minutes,
        summary: `Opened up "${data.title}" for you (${data.estimated_minutes} min).`,
      },
    };
  }

  if (name === "suggest_stepup") {
    return {
      result:
        "The app is now showing this person a small set of professional care options alongside your reply. Acknowledge it warmly and briefly, make clear it isn't a diagnosis or something they did wrong, and stay in the conversation with them.",
      action: {
        type: "stepup_suggested",
        summary: "Shared some options for more support.",
      },
    };
  }

  return { result: `Unknown tool: ${name}` };
}
