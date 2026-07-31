import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const MoodInput = z.object({
  score: z.number().int().min(1).max(5),
  note: z.string().trim().max(500).optional().default(""),
  tags: z.array(z.string().trim().max(40)).max(10).default([]),
});

export const logMood = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => MoodInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase.from("mood_logs").insert({
      user_id: userId,
      score: data.score,
      note: data.note || null,
      tags: data.tags,
      is_baseline: false,
    });
    if (error) throw error;
    return { ok: true };
  });
