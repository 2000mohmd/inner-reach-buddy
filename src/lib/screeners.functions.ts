import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  SCREENERS,
  SCREENER_INTERVAL_DAYS,
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
    const { submitScreenerCore } = await import("./screeners.server");
    return submitScreenerCore(context.supabase, context.userId, data);
  });


