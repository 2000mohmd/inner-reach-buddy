// Single source of truth for screener submission, including the PHQ-9 item-9
// crisis escalation. Both the standalone check-ins page (screeners.functions.ts)
// and the in-chat screener tool (companion-tools.server.ts) call this — the
// escalation must never be duplicated or bypassed.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { buildCrisisResponse, type CrisisResponse } from "./crisis";
import { SCREENERS, SCREENER_INTERVAL_DAYS, scoreSeverity, type ScreenerType } from "./screeners";

type Client = SupabaseClient<Database>;

export type SubmitScreenerResult = {
  id: string;
  total_score: number;
  severity: string;
  taken_at: string;
  crisisTriggered: boolean;
  crisis: CrisisResponse | null;
};

export async function submitScreenerCore(
  supabase: Client,
  userId: string,
  input: { screener_type: ScreenerType; responses: number[] },
): Promise<SubmitScreenerResult> {
  const expected = SCREENERS[input.screener_type].items.length;
  if (input.responses.length !== expected) {
    throw new Error("Please answer every item before submitting.");
  }

  const total = input.responses.reduce((sum, value) => sum + value, 0);
  const severity = scoreSeverity(input.screener_type, total);

  const saved = await supabase
    .from("screener_responses")
    .insert({
      user_id: userId,
      screener_type: input.screener_type,
      responses: input.responses,
      total_score: total,
      severity,
    })
    .select("id, total_score, severity, taken_at")
    .single();
  if (saved.error) throw saved.error;

  // PHQ-9 item 9 ("better off dead or of hurting yourself") escalates on its
  // own, independent of total score or severity band. A low total must never
  // suppress this.
  let crisis: CrisisResponse | null = null;
  const item9 = input.responses[8] ?? 0;
  if (input.screener_type === "phq9" && item9 >= 1) {
    // Triage: answering 2-3 ("more than half the days" / "nearly every day")
    // is treated as high; 1 ("several days") as passive/moderate ideation.
    const severity = item9 >= 2 ? "high" : "moderate";
    crisis = buildCrisisResponse(["phq9_item9"], severity);
    const { logCrisisEvent } = await import("./crisis-alert.server");
    await logCrisisEvent(supabase, {
      userId,
      source: "phq9_item9",
      severity,
      matchedTerms: ["phq9_item9"],
      notes: `PHQ-9 item 9 answered ${item9}/3.`,
    });
  }

  // Ordinary submissions should still land somewhere human: close the loop in
  // chat with a plain-language activity card and a short reaction referencing
  // the trend. Elevated/worsening scores are still handled separately by the
  // screener_step_up nudge trigger.
  if (!crisis) {
    try {
      const [history, profile] = await Promise.all([
        supabase
          .from("screener_responses")
          .select("total_score, severity, taken_at")
          .eq("user_id", userId)
          .eq("screener_type", input.screener_type)
          .neq("id", saved.data.id)
          .order("taken_at", { ascending: false })
          .limit(3),
        supabase.from("profiles").select("preferred_name").eq("id", userId).maybeSingle(),
      ]);

      const previous = history.data?.[0] ?? null;
      const max = SCREENERS[input.screener_type].items.length * 3;
      const share = total / max;
      const plain =
        share <= 0.2
          ? "things have felt mostly steady"
          : share <= 0.4
            ? "things have felt a little heavy"
            : share <= 0.6
              ? "things have felt heavier than easy lately"
              : "things have felt really heavy lately";
      const direction = previous
        ? total < previous.total_score - 1
          ? "a bit lighter than last time"
          : total > previous.total_score + 1
            ? "a bit heavier than last time"
            : "about the same as last time"
        : null;

      const { postActivityToChat } = await import("./companion-reaction.server");
      await postActivityToChat({
        supabase,
        userId,
        activityLabel: `Checked in: ${plain}${direction ? ` — ${direction}` : ""}`,
        preferredName: profile.data?.preferred_name ?? null,
        reactionInstruction: [
          `They just finished a periodic check-in in the app (${SCREENERS[input.screener_type].label}).`,
          `In plain terms, ${plain}.`,
          previous && direction
            ? `Compared with their previous check-in on ${new Date(previous.taken_at).toISOString().slice(0, 10)}, it's ${direction}.`
            : "This is their first check-in of this kind, so there's no trend to compare against yet.",
          "Thank them warmly in one or two sentences and reflect the direction in everyday language. Never quote scores, score names, severity bands or clinical terms. No advice list.",
        ].join(" "),
      });
    } catch (error) {
      console.error("screener activity post failed", error);
    }
  }

  return { ...saved.data, crisisTriggered: crisis !== null, crisis };
}

/** Same "roughly every two weeks" rule the check-ins page uses. */
export async function getScreenersDue(supabase: Client, userId: string) {
  const { data } = await supabase
    .from("screener_responses")
    .select("screener_type, total_score, severity, taken_at")
    .eq("user_id", userId)
    .order("taken_at", { ascending: true });

  const history = data ?? [];
  return (["phq9", "gad7"] as ScreenerType[]).map((type) => {
    const latest = history.filter((entry) => entry.screener_type === type).at(-1) ?? null;
    const dueAt = latest
      ? new Date(new Date(latest.taken_at).getTime() + SCREENER_INTERVAL_DAYS * 86400000)
      : null;
    return {
      type,
      label: SCREENERS[type].label,
      latest,
      due: !dueAt || dueAt <= new Date(),
    };
  });
}
