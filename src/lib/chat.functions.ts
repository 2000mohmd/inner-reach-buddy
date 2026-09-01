import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { triageCrisis, type CrisisResponse } from "./crisis";
import { QUICK_ACTION_IDS } from "./quick-actions";
import { getRateLimiter, RATE_LIMIT_MESSAGE } from "./rate-limit";
import type { CompanionAction } from "./companion-tools.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const HISTORY_LIMIT = 20;

const SendInput = z.object({
  thread_id: z.string().uuid().optional(),
  content: z.string().trim().min(1).max(4000),
  quick_action: z
    .string()
    .refine((value) => QUICK_ACTION_IDS.includes(value))
    .nullish(),
});

/** Visible per-user token / estimated-cost counter (this UTC day + lifetime). */
export const getChatUsage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    return getRateLimiter(supabase).getUsage(userId);
  });

export async function listThreadsCore(supabase: SupabaseClient<Database>, userId: string) {
  const { data, error } = await supabase
    .from("chat_threads")
    .select("id, title, created_at, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export const listThreads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) => listThreadsCore(context.supabase, context.userId));

export const createThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("chat_threads")
      .insert({ user_id: userId })
      .select("id, title, created_at, updated_at")
      .single();
    if (error) throw error;
    return data;
  });

const MESSAGE_COLS =
  "id, sender, content, content_type, exercise_slug, flagged_crisis, quick_action, created_at";

async function loadOwnedThread(
  supabase: SupabaseClient<Database>,
  userId: string,
  threadId: string,
) {
  const thread = await supabase
    .from("chat_threads")
    .select("id, title, created_at, updated_at")
    .eq("id", threadId)
    .eq("user_id", userId)
    .maybeSingle();
  if (thread.error) throw thread.error;
  if (!thread.data) throw new Error("Thread not found");
  return thread.data;
}

export async function getThreadHistoryCore(
  supabase: SupabaseClient<Database>,
  userId: string,
  input: { thread_id: string },
) {
  const [thread, messages] = await Promise.all([
    loadOwnedThread(supabase, userId, input.thread_id),
    supabase
      .from("chat_messages")
      .select(MESSAGE_COLS)
      .eq("thread_id", input.thread_id)
      .eq("user_id", userId)
      .order("created_at", { ascending: true }),
  ]);
  if (messages.error) throw messages.error;
  return { thread, messages: messages.data ?? [] };
}

/**
 * Keyset-paginated newest-first page of a thread's messages, for the mobile
 * infinite-scroll history view. `before` is an ISO `created_at` cursor (exclusive)
 * from a previous page's `nextBefore`. Reuses the ownership check + column list
 * from getThreadHistoryCore.
 */
export async function getThreadMessagesPageCore(
  supabase: SupabaseClient<Database>,
  userId: string,
  input: { thread_id: string; limit?: number; before?: string | null },
) {
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 50), 1), 200);
  const thread = await loadOwnedThread(supabase, userId, input.thread_id);

  let query = supabase
    .from("chat_messages")
    .select(MESSAGE_COLS)
    .eq("thread_id", input.thread_id)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit + 1);
  if (input.before) query = query.lt("created_at", input.before);

  const { data, error } = await query;
  if (error) throw error;

  const rows = data ?? [];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    thread,
    // ascending for display; the cursor is the oldest row we returned
    messages: [...page].reverse(),
    nextBefore: hasMore ? (page[page.length - 1]?.created_at ?? null) : null,
  };
}

export const getThreadHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ thread_id: z.string().uuid() }).parse(input))
  .handler(({ data, context }) =>
    getThreadHistoryCore(context.supabase, context.userId, { thread_id: data.thread_id }),
  );

export const deleteThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ thread_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("chat_threads")
      .delete()
      .eq("id", data.thread_id)
      .eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });

export type SendMessageResult = {
  thread_id: string;
  userMessage: {
    id: string;
    sender: "user";
    content: string;
    flagged_crisis: boolean;
    created_at: string;
  };
  reply:
    | {
        type: "message";
        id: string;
        content: string;
        created_at: string;
        actions: CompanionAction[];
      }
    | (CrisisResponse & { id: string; created_at: string });
};

/**
 * The core of sendMessage, decoupled from transport. Both the web RPC
 * (`sendMessage` below) and the mobile route (src/routes/api/v1/chat/messages.ts)
 * call this with an already-authenticated Supabase client + userId, so the
 * crisis gate / rate limiter / companion logic behaves identically regardless of
 * which entry point the request came through.
 *
 * ORDERING GUARANTEE — DO NOT REORDER: the crisis gate (runCrisisGate) runs
 * BEFORE the per-user rate limiter. Tested against runCrisisGate directly in
 * crisis-gate.test.ts and through this function (via the mobile handler) in
 * chat-messages-ordering.test.ts.
 */
export async function sendMessageCore(
  supabase: SupabaseClient<Database>,
  userId: string,
  input: unknown,
): Promise<SendMessageResult> {
  const data = SendInput.parse(input);

  // Resolve or create the thread.
  let threadId = data.thread_id ?? null;
  if (threadId) {
    const owned = await supabase
      .from("chat_threads")
      .select("id")
      .eq("id", threadId)
      .eq("user_id", userId)
      .maybeSingle();
    if (owned.error) throw owned.error;
    if (!owned.data) throw new Error("Thread not found");
  } else {
    const created = await supabase
      .from("chat_threads")
      .insert({ user_id: userId, title: data.content.slice(0, 60) })
      .select("id")
      .single();
    if (created.error) throw created.error;
    threadId = created.data.id;
  }

  // --- Crisis gate: runs BEFORE any companion LLM call and BEFORE the
  // per-user rate limiter (see crisis-gate.server.ts). DO NOT REORDER. ---
  const triage = triageCrisis(data.content);

  const savedUser = await supabase
    .from("chat_messages")
    .insert({
      thread_id: threadId,
      user_id: userId,
      sender: "user",
      content: data.content,
      flagged_crisis: triage.matched.length > 0,
      quick_action: data.quick_action ?? null,
    })
    .select("id, content, flagged_crisis, created_at")
    .single();
  if (savedUser.error) throw savedUser.error;

  // Fetched in parallel with recentTurns so the crisis gate gets the user's
  // locale (for localized crisis copy) without adding a round trip. A failure
  // here just falls back to English copy — never blocks the gate.
  const [recentTurns, profileLang] = await Promise.all([
    supabase
      .from("chat_messages")
      .select("sender, content")
      .eq("thread_id", threadId)
      .eq("user_id", userId)
      .neq("id", savedUser.data.id)
      .order("created_at", { ascending: false })
      .limit(2),
    supabase.from("profiles").select("language").eq("id", userId).maybeSingle(),
  ]);

  const { runCrisisGate } = await import("./crisis-gate.server");
  const gated = await runCrisisGate(supabase, {
    userId,
    threadId,
    messageId: savedUser.data.id,
    content: data.content,
    language: profileLang.data?.language ?? null,
    recentTurns: (recentTurns.data ?? [])
      .reverse()
      .map((row) => ({ sender: row.sender, content: row.content })),
  });

  if (gated) {
    return {
      thread_id: threadId,
      userMessage: {
        ...savedUser.data,
        flagged_crisis: true,
        sender: "user" as const,
      },
      reply: {
        ...gated.crisis,
        id: gated.systemMessage.id,
        created_at: gated.systemMessage.created_at,
      },
    };
  }

  // --- Per-user rate limit (normal chat path only; never gates crisis).
  // Both crisis checks above have already run and come up clear. Enforces a
  // short sliding window AND a daily message cap; fails open. ---
  const rateLimiter = getRateLimiter(supabase);
  const limit = await rateLimiter.checkAndConsume(userId);
  if (!limit.allowed) {
    const savedLimit = await supabase
      .from("chat_messages")
      .insert({
        thread_id: threadId,
        user_id: userId,
        sender: "system",
        content: limit.message ?? RATE_LIMIT_MESSAGE,
      })
      .select("id, content, created_at")
      .single();
    if (savedLimit.error) throw savedLimit.error;

    return {
      thread_id: threadId,
      userMessage: { ...savedUser.data, sender: "user" as const },
      reply: {
        type: "message",
        id: savedLimit.data.id,
        content: savedLimit.data.content,
        created_at: savedLimit.data.created_at,
        actions: [],
      },
    };
  }

  // --- Cross-session memory: summarizing the thread they just left is slow
  // (an LLM call plus the Phase 11 session-drift sweep) and must never delay
  // this reply. Enqueue it and move on — enqueueJob does a fast insert, or an
  // immediate non-blocking fallback. The per-message crisis gate has already
  // run above, before the rate limiter; the drift sweep it defers is post-hoc
  // and best-effort, so deferring it does not weaken crisis handling. ---
  const { fetchRecentSummaries } = await import("./thread-summary.server");
  try {
    const { enqueueJob } = await import("@/jobs");
    await enqueueJob(supabase, {
      kind: "summarize_thread",
      userId,
      sinceThreadId: threadId,
    });
  } catch (error) {
    console.error("thread summary enqueue failed", error);
  }

  // --- Normal path: assemble personalized context, then call the model ---

  const { getScreenersDue } = await import("./screeners.server");
  const { computeEngagementStreak } = await import("./streak.server");

  const [profile, intro, moods, history, pastSummaries, screeners, streakDays, dailyPrompts] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("preferred_name, account_type, ai_context_consent")
        .eq("id", userId)
        .maybeSingle(),
      supabase
        .from("user_profiles")
        .select(
          "intro_text, goals, stressors, communication_preference, topics_to_avoid, in_professional_care",
        )
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("mood_logs")
        .select("score, note, tags, logged_at")
        .eq("user_id", userId)
        .order("logged_at", { ascending: false })
        .limit(7),
      supabase
        .from("chat_messages")
        .select("sender, content, created_at")
        .eq("thread_id", threadId)
        .eq("user_id", userId)
        .neq("id", savedUser.data.id)
        .order("created_at", { ascending: false })
        .limit(HISTORY_LIMIT),
      fetchRecentSummaries(supabase, userId, threadId).catch(() => []),
      getScreenersDue(supabase, userId).catch(() => []),
      computeEngagementStreak(supabase, userId).catch(() => 0),
      supabase
        .from("daily_prompt_responses")
        .select("response_text, responded_at, daily_prompts(prompt_text)")
        .eq("user_id", userId)
        .order("responded_at", { ascending: false })
        .limit(3),
    ]);

  const consented = profile.data?.ai_context_consent !== false;
  const { generateCompanionReply } = await import("./ai-companion.server");

  const reply = await generateCompanionReply(
    {
      preferredName: profile.data?.preferred_name ?? null,
      accountType: profile.data?.account_type ?? null,
      introText: consented ? (intro.data?.intro_text ?? null) : null,
      goals: consented ? (intro.data?.goals ?? []) : [],
      stressors: consented ? (intro.data?.stressors ?? []) : [],
      communicationPreference: intro.data?.communication_preference ?? null,
      topicsToAvoid: intro.data?.topics_to_avoid ?? null,
      inProfessionalCare: intro.data?.in_professional_care ?? false,
      recentMoods: consented ? (moods.data ?? []) : [],
      history: (history.data ?? [])
        .filter((entry) => entry.sender !== "system")
        .reverse()
        .map((entry) => ({ sender: entry.sender, content: entry.content })),
      quickAction: data.quick_action ?? null,
      pastSummaries: consented ? pastSummaries : [],
      streakDays,
      dailyPromptResponses: consented
        ? (dailyPrompts.data ?? []).map((row) => ({
            prompt: (row.daily_prompts as { prompt_text: string } | null)?.prompt_text ?? "",
            response: row.response_text,
            when: row.responded_at.slice(0, 10),
          }))
        : [],
      screenersDue: screeners.map((entry) => ({
        label: entry.label,
        due: entry.due,
        lastTaken: entry.latest ? entry.latest.taken_at.slice(0, 10) : null,
      })),
    },
    data.content,
    { supabase, userId, threadId },
  );

  // Token/cost counter — fire-and-forget, never blocks or fails the reply.
  void rateLimiter.recordUsage(userId, {
    inputTokens: reply.usage.inputTokens,
    outputTokens: reply.usage.outputTokens,
    provider: reply.usage.provider,
    model: reply.usage.model,
  });

  // Make tool-driven actions visible in the transcript, never silent.
  const actionLines = reply.actions.map((action) => `• ${action.summary}`);
  const replyText = actionLines.length ? `${reply.text}\n\n${actionLines.join("\n")}` : reply.text;

  const savedReply = await supabase
    .from("chat_messages")
    .insert({
      thread_id: threadId,
      user_id: userId,
      sender: "assistant",
      content: replyText,
    })
    .select("id, content, created_at")
    .single();
  if (savedReply.error) throw savedReply.error;

  await supabase
    .from("chat_threads")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", threadId);

  return {
    thread_id: threadId,
    userMessage: { ...savedUser.data, sender: "user" as const },
    reply: {
      type: "message",
      id: savedReply.data.id,
      content: savedReply.data.content,
      created_at: savedReply.data.created_at,
      actions: reply.actions,
    },
  };
}

export const sendMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SendInput.parse(input))
  .handler(({ data, context }): Promise<SendMessageResult> =>
    sendMessageCore(context.supabase, context.userId, data),
  );
