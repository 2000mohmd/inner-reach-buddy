import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/** Runs the proactive-coaching evaluation, then returns the live nudges. */
export const getNudges = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ evaluate: z.boolean().default(true) }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    if (data.evaluate) {
      try {
        const { evaluateNudgesFor } = await import("./nudges.server");
        await evaluateNudgesFor(supabase, userId);
      } catch (error) {
        console.error("nudge evaluation failed", error);
      }
    }

    const [nudges, resources] = await Promise.all([
      supabase
        .from("nudges")
        .select(
          "id, trigger_type, message, suggested_exercise_slug, resource_ids, acted_on, created_at",
        )
        .eq("user_id", userId)
        .is("dismissed_at", null)
        .order("created_at", { ascending: false })
        .limit(3),
      supabase
        .from("care_resources")
        .select("id, resource_type, name, description, contact_or_url")
        .eq("is_active", true)
        .order("sort_order", { ascending: true }),
    ]);
    if (nudges.error) throw nudges.error;
    if (resources.error) throw resources.error;

    const byId = new Map((resources.data ?? []).map((row) => [row.id, row]));
    return {
      nudges: (nudges.data ?? []).map((nudge) => ({
        ...nudge,
        resources: (nudge.resource_ids ?? [])
          .map((id) => byId.get(id))
          .filter((row): row is NonNullable<typeof row> => Boolean(row)),
      })),
    };
  });

export const updateNudge = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        dismiss: z.boolean().default(false),
        acted_on: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("nudges")
      .update({
        ...(data.dismiss ? { dismissed_at: new Date().toISOString() } : {}),
        ...(data.acted_on === undefined ? {} : { acted_on: data.acted_on }),
      })
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });

export const listCareResources = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("care_resources")
      .select("id, resource_type, name, description, contact_or_url, region")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    if (error) throw error;
    return data ?? [];
  });
