import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  SCREENERS,
  SCREENER_INTERVAL_DAYS,
  scoreSeverity,
  type ScreenerType,
} from "./screeners";

const SubmitInput = z.object({
  screener_type: z.enum(["phq9", "gad7"]),
  responses: z.array(z.number().int().min(0).max(3)).min(7).max(9),
});

export const getScreenerState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("screener_responses")
      .select("id, screener_type, total_score, severity, taken_at")
      .eq("user_id", userId)
      .order("taken_at", { ascending: true });
    if (error) throw error;

    const history = data ?? [];
    const state = (["phq9", "gad7"] as ScreenerType[]).map((type) => {
      const forType = history.filter((entry) => entry.screener_type === type);
      const latest = forType.at(-1) ?? null;
      const dueAt = latest
        ? new Date(
            new Date(latest.taken_at).getTime() + SCREENER_INTERVAL_DAYS * 86400000,
          ).toISOString()
        : null;
      return {
        type,
        label: SCREENERS[type].label,
        latest,
        due: !latest || new Date(dueAt as string) <= new Date(),
        dueAt,
        history: forType,
      };
    });

    return { screeners: state };
  });

export const submitScreener = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SubmitInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const expected = SCREENERS[data.screener_type].items.length;
    if (data.responses.length !== expected) {
      throw new Error("Please answer every item before submitting.");
    }

    const total = data.responses.reduce((sum, value) => sum + value, 0);
    const severity = scoreSeverity(data.screener_type, total);

    const saved = await supabase
      .from("screener_responses")
      .insert({
        user_id: userId,
        screener_type: data.screener_type,
        responses: data.responses,
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
    if (data.screener_type === "phq9" && (data.responses[8] ?? 0) >= 1) {
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
  });

