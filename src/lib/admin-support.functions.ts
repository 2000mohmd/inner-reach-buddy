// Admin-facing support inbox + super_admin-only team/role management.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

async function assertAdmin(supabase: SupabaseClient<Database>, userId: string) {
  const [admin, superAdmin] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "super_admin" }),
  ]);
  if (admin.error) throw new Error(admin.error.message);
  if (!admin.data && !superAdmin.data) throw new Error("Forbidden");
}

/**
 * Role management is a strictly higher privilege than day-to-day admin work:
 * an admin must not be able to grant themselves (or anyone) admin access.
 */
async function assertSuperAdmin(supabase: SupabaseClient<Database>, userId: string) {
  const { data, error } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "super_admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

export const listSupportThreads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { fetchAdminSupportThreads } = await import("./support.server");
    return fetchAdminSupportThreads(context.supabase);
  });

export const getSupportThreadForAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ thread_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { fetchAdminSupportThread } = await import("./support.server");
    return fetchAdminSupportThread(context.supabase, data.thread_id);
  });

export const replyToSupportThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        thread_id: z.string().uuid(),
        message: z.string().trim().min(2).max(4000),
        status: z.enum(["open", "in_progress", "resolved"]).nullish(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const thread = await supabase
      .from("support_threads")
      .select("id, user_id, subject, status")
      .eq("id", data.thread_id)
      .maybeSingle();
    if (thread.error) throw new Error(thread.error.message);
    if (!thread.data) throw new Error("Not found");

    const insert = await supabase.from("support_messages").insert({
      thread_id: data.thread_id,
      sender: "admin",
      content: data.message,
    });
    if (insert.error) throw new Error(insert.error.message);

    const nextStatus =
      data.status ?? (thread.data.status === "open" ? "in_progress" : thread.data.status);
    const update = await supabase
      .from("support_threads")
      .update({ status: nextStatus, updated_at: new Date().toISOString() })
      .eq("id", data.thread_id);
    if (update.error) throw new Error(update.error.message);

    const [{ sendSupportReplyEmail }, { logAuditEntry }] = await Promise.all([
      import("./support.server"),
      import("./admin-audit.server"),
    ]);
    const emailed = await sendSupportReplyEmail({
      userId: thread.data.user_id,
      threadId: data.thread_id,
      subject: thread.data.subject,
      reply: data.message,
    });
    await logAuditEntry({
      adminUserId: userId,
      action: "replied_support_ticket",
      targetType: "support_thread",
      targetId: data.thread_id,
      metadata: { status: nextStatus, emailed },
    });

    return { ok: true, status: nextStatus, emailed };
  });

export const setSupportThreadStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        thread_id: z.string().uuid(),
        status: z.enum(["open", "in_progress", "resolved"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("support_threads")
      .update({ status: data.status, updated_at: new Date().toISOString() })
      .eq("id", data.thread_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listTeam = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuperAdmin(context.supabase, context.userId);
    const { fetchTeam } = await import("./admin-team.server");
    return fetchTeam();
  });

export const searchUsersForRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ query: z.string().max(120) }).parse(input))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.supabase, context.userId);
    const { searchUsersForRoles } = await import("./admin-team.server");
    return { results: await searchUsersForRoles(data.query) };
  });

export const changeUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        user_id: z.string().uuid(),
        role: z.enum(["admin", "super_admin"]),
        grant: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertSuperAdmin(supabase, userId);

    const { setUserRole, countSuperAdmins } = await import("./admin-team.server");
    if (data.role === "super_admin" && !data.grant) {
      const remaining = await countSuperAdmins();
      if (remaining <= 1) throw new Error("At least one super admin must remain.");
    }

    await setUserRole({ targetUserId: data.user_id, role: data.role, grant: data.grant });

    const { logAuditEntry } = await import("./admin-audit.server");
    await logAuditEntry({
      adminUserId: userId,
      action: data.grant ? "granted_role" : "revoked_role",
      targetType: "user",
      targetId: data.user_id,
      metadata: { role: data.role },
    });

    return { ok: true };
  });
