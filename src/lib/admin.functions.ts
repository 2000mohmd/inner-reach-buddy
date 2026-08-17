import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { severityRank } from "./crisis";

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
  const [{ data, error }, superAdmin] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "super_admin" }),
  ]);
  if (error) throw new Error(error.message);
  if (!data && !superAdmin.data) throw new Error("Forbidden");
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
    const superAdmin = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "super_admin",
    });
    if (superAdmin.error) throw superAdmin.error;
    return { isAdmin: Boolean(data) || Boolean(superAdmin.data), isSuperAdmin: Boolean(superAdmin.data) };
  });

export const listCrisisEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ events: CrisisReviewRow[]; unreviewed: number }> => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const { data, error } = await supabase
      .from("crisis_events")
      .select("id, user_id, created_at, source, severity, matched_terms, notes, reviewed, reviewed_at")
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

    // Triage order: unreviewed first, then by severity (critical → high →
    // moderate), then newest first.
    const events = rows
      .map((row) => ({
        id: row.id,
        created_at: row.created_at,
        source: row.source,
        severity: row.severity,
        matched_terms: row.matched_terms ?? [],
        notes: row.notes ?? null,
        reviewed: row.reviewed,
        reviewed_at: row.reviewed_at ?? null,
        preferred_name: names.get(row.user_id) ?? null,
      }))
      .sort((a, b) => {
        if (a.reviewed !== b.reviewed) return a.reviewed ? 1 : -1;
        const bySeverity = severityRank(a.severity) - severityRank(b.severity);
        if (bySeverity !== 0) return bySeverity;
        return b.created_at.localeCompare(a.created_at);
      });

    return {
      events,
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

    const { logAuditEntry } = await import("./admin-audit.server");
    await logAuditEntry({
      adminUserId: userId,
      action: "resolved_crisis_event",
      targetType: "crisis_event",
      targetId: data.event_id,
    });
    return { ok: true };
  });

/** Aggregate, non-identifying platform metrics for the admin Overview page. */
export const getAdminOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { fetchOverviewMetrics } = await import("./admin-metrics.server");
    return fetchOverviewMetrics();
  });

export const listAdminUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { fetchAdminUsers } = await import("./admin-metrics.server");
    return { users: await fetchAdminUsers() };
  });

/** Per-user admin detail. Deliberately excludes chat transcripts. */
export const getAdminUserDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ user_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const [{ fetchAdminUserDetail }, { logAuditEntry }] = await Promise.all([
      import("./admin-metrics.server"),
      import("./admin-audit.server"),
    ]);
    const detail = await fetchAdminUserDetail(data.user_id);
    await logAuditEntry({
      adminUserId: context.userId,
      action: "viewed_user",
      targetType: "user",
      targetId: data.user_id,
    });
    return detail;
  });

export const listAdminAuditLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        admin_user_id: z.string().uuid().nullish(),
        action: z.string().nullish(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { fetchAuditLog } = await import("./admin-audit.server");
    return fetchAuditLog({
      adminUserId: data.admin_user_id ?? null,
      action: data.action ?? null,
    });
  });
