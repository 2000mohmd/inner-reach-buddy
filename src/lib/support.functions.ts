// Product/account support channel. Deliberately separate from crisis_events
// and chat_messages: this is a low-stakes admin↔member channel for account
// issues and feedback, never a mental-health-support path.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type SupportThreadSummary = {
  id: string;
  subject: string;
  status: "open" | "in_progress" | "resolved";
  created_at: string;
  updated_at: string;
  last_message: string | null;
  last_sender: "user" | "admin" | null;
};

export type SupportMessage = {
  id: string;
  sender: "user" | "admin";
  content: string;
  created_at: string;
};

export const SUPPORT_STATUS_LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
};

export const listMySupportThreads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ threads: SupportThreadSummary[] }> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("support_threads")
      .select("id, subject, status, created_at, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) throw error;

    const threads = data ?? [];
    if (!threads.length) return { threads: [] };

    const messages = await supabase
      .from("support_messages")
      .select("thread_id, sender, content, created_at")
      .in(
        "thread_id",
        threads.map((thread) => thread.id),
      )
      .order("created_at", { ascending: true });
    if (messages.error) throw messages.error;

    const latest = new Map<string, { sender: "user" | "admin"; content: string }>();
    for (const message of messages.data ?? []) {
      latest.set(message.thread_id, { sender: message.sender, content: message.content });
    }

    return {
      threads: threads.map((thread) => ({
        id: thread.id,
        subject: thread.subject,
        status: thread.status,
        created_at: thread.created_at,
        updated_at: thread.updated_at,
        last_message: latest.get(thread.id)?.content ?? null,
        last_sender: latest.get(thread.id)?.sender ?? null,
      })),
    };
  });

export const getMySupportThread = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ thread_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const thread = await supabase
      .from("support_threads")
      .select("id, subject, status, created_at, updated_at")
      .eq("id", data.thread_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (thread.error) throw thread.error;
    if (!thread.data) throw new Error("Not found");

    const messages = await supabase
      .from("support_messages")
      .select("id, sender, content, created_at")
      .eq("thread_id", data.thread_id)
      .order("created_at", { ascending: true });
    if (messages.error) throw messages.error;

    return {
      thread: thread.data,
      messages: (messages.data ?? []) as SupportMessage[],
    };
  });

export const createSupportThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        subject: z.string().trim().min(3).max(120),
        message: z.string().trim().min(5).max(4000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const thread = await supabase
      .from("support_threads")
      .insert({ user_id: userId, subject: data.subject })
      .select("id")
      .single();
    if (thread.error) throw thread.error;

    const message = await supabase.from("support_messages").insert({
      thread_id: thread.data.id,
      sender: "user",
      content: data.message,
    });
    if (message.error) throw message.error;

    return { thread_id: thread.data.id };
  });

export const replyToMySupportThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        thread_id: z.string().uuid(),
        message: z.string().trim().min(2).max(4000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const thread = await supabase
      .from("support_threads")
      .select("id")
      .eq("id", data.thread_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (thread.error) throw thread.error;
    if (!thread.data) throw new Error("Not found");

    const { error } = await supabase.from("support_messages").insert({
      thread_id: data.thread_id,
      sender: "user",
      content: data.message,
    });
    if (error) throw error;

    // Bump the thread so it resurfaces at the top of the admin inbox.
    const { touchSupportThread } = await import("./support.server");
    await touchSupportThread(data.thread_id);
    return { ok: true };
  });
