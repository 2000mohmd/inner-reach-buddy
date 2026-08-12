import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Daily reflection ritual. Deliberately separate from mood check-ins and
 * screeners: responses are never scored, never analysed for severity, and
 * never feed risk logic.
 */
export const getTodayPrompt = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const prompts = await supabase
      .from("daily_prompts")
      .select("id, prompt_text, prompt_type")
      .eq("active", true)
      .order("sort_order", { ascending: true });
    if (prompts.error) throw prompts.error;

    const pool = prompts.data ?? [];
    if (pool.length === 0) return { prompt: null, response: null };

    // Rotate by day so everyone sees a stable prompt for the whole day.
    const dayIndex = Math.floor(Date.now() / 86_400_000) % pool.length;
    const prompt = pool[dayIndex]!;

    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    const response = await supabase
      .from("daily_prompt_responses")
      .select("id, response_text, responded_at")
      .eq("user_id", userId)
      .eq("prompt_id", prompt.id)
      .gte("responded_at", startOfDay.toISOString())
      .order("responded_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (response.error) throw response.error;

    return { prompt, response: response.data ?? null };
  });

export const answerDailyPrompt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        prompt_id: z.string().uuid(),
        response_text: z.string().trim().min(1).max(2000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("daily_prompt_responses").insert({
      user_id: userId,
      prompt_id: data.prompt_id,
      response_text: data.response_text,
    });
    if (error) throw error;
    return { ok: true };
  });
