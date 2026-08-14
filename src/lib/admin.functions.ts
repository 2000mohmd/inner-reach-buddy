import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type CrisisReviewRow = {
  id: string;
  created_at: string;
  source: string;
  severity: string;
  matched_terms: string[];
  notes: string | null;
  reviewed: boolean;
  reviewed_at: string | null;
  preferred_name: string | null;
};

async function assertAdmin(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<void> {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

/** Cheap check the UI (and the sidebar badge) uses to decide what to render. */
export const amIAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (error) throw error;
    return { isAdmin: Boolean(data) };
  });

export const listCrisisEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ events: CrisisReviewRow[]; unreviewed: number }> => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const { data, error } = await supabase
      .from("crisis_events")
      .select("id, user_id, created_at, source, severity, matched_terms, notes, reviewed, reviewed_at")
      .order("reviewed", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;

    const rows = data ?? [];
    const userIds = [...new Set(rows.map((row) => row.user_id))];
    const names = new Map<string, string | null>();
    if (userIds.length) {
      const profiles = await supabase
        .from("profiles")
        .select("id, preferred_name")
        .in("id", userIds);
      if (profiles.error) throw profiles.error;
      for (const profile of profiles.data ?? []) names.set(profile.id, profile.preferred_name);
    }

    return {
      events: rows.map((row) => ({
        id: row.id,
        created_at: row.created_at,
        source: row.source,
        severity: row.severity,
        matched_terms: row.matched_terms ?? [],
        notes: row.notes ?? null,
        reviewed: row.reviewed,
        reviewed_at: row.reviewed_at ?? null,
        preferred_name: names.get(row.user_id) ?? null,
      })),
      unreviewed: rows.filter((row) => !row.reviewed).length,
    };
  });

export const countUnreviewedCrisisEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) return { isAdmin: false, unreviewed: 0 };

    const { count, error } = await supabase
      .from("crisis_events")
      .select("id", { count: "exact", head: true })
      .eq("reviewed", false);
    if (error) throw error;
    return { isAdmin: true, unreviewed: count ?? 0 };
  });

export const markCrisisReviewed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ event_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const { error } = await supabase
      .from("crisis_events")
      .update({ reviewed: true, reviewed_by: userId, reviewed_at: new Date().toISOString() })
      .eq("id", data.event_id);
    if (error) throw error;
    return { ok: true };
  });
