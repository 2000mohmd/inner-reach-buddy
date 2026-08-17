// Server-only helpers for the support channel: admin inbox reads, admin
// replies, and the "you have a reply" notification email.
//
// Email reuses the same Resend pattern as crisis alerting, but the audience is
// the member (not an admin) and the body contains only a short excerpt plus a
// link back into the app — never the full reply.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Client = SupabaseClient<Database>;

const RESEND_URL = "https://api.resend.com/emails";
const FROM = "Kalm Support <onboarding@resend.dev>";

function appBaseUrl(): string {
  return (
    process.env["APP_BASE_URL"] ??
    process.env["VITE_APP_BASE_URL"] ??
    "https://inner-reach-buddy.lovable.app"
  );
}

export type AdminSupportThread = {
  id: string;
  user_id: string;
  subject: string;
  status: "open" | "in_progress" | "resolved";
  created_at: string;
  updated_at: string;
  preferred_name: string | null;
  last_message: string | null;
  last_sender: "user" | "admin" | null;
  message_count: number;
};

const STATUS_ORDER: Record<string, number> = { open: 0, in_progress: 1, resolved: 2 };

/** Keeps admin-inbox ordering meaningful when a member adds a message. */
export async function touchSupportThread(threadId: string): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("support_threads")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", threadId);
    if (error) console.error("[support] touch failed", error.message);
  } catch (error) {
    console.error("[support] touch threw", error);
  }
}

export async function fetchAdminSupportThreads(
  supabase: Client,
): Promise<{ threads: AdminSupportThread[]; openCount: number }> {
  const { data, error } = await supabase
    .from("support_threads")
    .select("id, user_id, subject, status, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) throw error;

  const rows = data ?? [];
  if (!rows.length) return { threads: [], openCount: 0 };

  const [messages, profiles] = await Promise.all([
    supabase
      .from("support_messages")
      .select("thread_id, sender, content, created_at")
      .in(
        "thread_id",
        rows.map((row) => row.id),
      )
      .order("created_at", { ascending: true }),
    supabase
      .from("profiles")
      .select("id, preferred_name")
      .in("id", [...new Set(rows.map((row) => row.user_id))]),
  ]);
  if (messages.error) throw messages.error;
  if (profiles.error) throw profiles.error;

  const names = new Map((profiles.data ?? []).map((p) => [p.id, p.preferred_name]));
  const latest = new Map<string, { sender: "user" | "admin"; content: string }>();
  const counts = new Map<string, number>();
  for (const message of messages.data ?? []) {
    latest.set(message.thread_id, { sender: message.sender, content: message.content });
    counts.set(message.thread_id, (counts.get(message.thread_id) ?? 0) + 1);
  }

  const threads = rows
    .map((row) => ({
      id: row.id,
      user_id: row.user_id,
      subject: row.subject,
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
      preferred_name: names.get(row.user_id) ?? null,
      last_message: latest.get(row.id)?.content ?? null,
      last_sender: latest.get(row.id)?.sender ?? null,
      message_count: counts.get(row.id) ?? 0,
    }))
    .sort((a, b) => {
      const byStatus = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
      if (byStatus !== 0) return byStatus;
      return b.updated_at.localeCompare(a.updated_at);
    });

  return { threads, openCount: rows.filter((row) => row.status !== "resolved").length };
}

export async function fetchAdminSupportThread(
  supabase: Client,
  threadId: string,
): Promise<{
  thread: AdminSupportThread;
  messages: { id: string; sender: "user" | "admin"; content: string; created_at: string }[];
}> {
  const thread = await supabase
    .from("support_threads")
    .select("id, user_id, subject, status, created_at, updated_at")
    .eq("id", threadId)
    .maybeSingle();
  if (thread.error) throw thread.error;
  if (!thread.data) throw new Error("Not found");

  const [messages, profile] = await Promise.all([
    supabase
      .from("support_messages")
      .select("id, sender, content, created_at")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true }),
    supabase.from("profiles").select("preferred_name").eq("id", thread.data.user_id).maybeSingle(),
  ]);
  if (messages.error) throw messages.error;

  const rows = messages.data ?? [];
  return {
    thread: {
      ...thread.data,
      preferred_name: profile.data?.preferred_name ?? null,
      last_message: rows.at(-1)?.content ?? null,
      last_sender: rows.at(-1)?.sender ?? null,
      message_count: rows.length,
    },
    messages: rows,
  };
}

function excerpt(text: string, max = 180): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Notify the member by email that support replied. Never blocks the reply. */
export async function sendSupportReplyEmail(input: {
  userId: string;
  threadId: string;
  subject: string;
  reply: string;
}): Promise<boolean> {
  const apiKey = process.env["RESEND_API_KEY"];
  if (!apiKey) {
    console.error("[support] reply email skipped: RESEND_API_KEY missing");
    return false;
  }

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const account = await supabaseAdmin.auth.admin.getUserById(input.userId);
    const to = account.data.user?.email;
    if (!to) {
      console.error("[support] reply email skipped: no account email");
      return false;
    }

    const link = `${appBaseUrl()}/support?thread=${input.threadId}`;
    const text = [
      "Kalm support replied to your message.",
      "",
      `Your request: ${input.subject}`,
      `Reply starts with: "${excerpt(input.reply)}"`,
      "",
      `Read the full reply and respond here: ${link}`,
      "",
      "This is an account/product support message. If you need urgent help, open Kalm and tap Support resources.",
    ].join("\n");

    const response = await fetch(RESEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from: FROM,
        to: [to],
        subject: `Kalm support replied — ${input.subject}`,
        text,
      }),
    });
    if (!response.ok) {
      console.error(`[support] reply email failed [${response.status}]: ${await response.text()}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error("[support] reply email threw", error);
    return false;
  }
}
