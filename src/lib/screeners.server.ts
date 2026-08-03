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
  if (input.screener_type === "phq9" && (input.responses[8] ?? 0) >= 1) {
    crisis = buildCrisisResponse(["phq9_item9"]);
    const logged = await supabase.from("crisis_events").insert({
      user_id: userId,
      matched_terms: ["phq9_item9"],
      severity: "high",
      source: "phq9_item9",
    });
    if (logged.error) console.error("crisis_events insert failed", logged.error);
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
