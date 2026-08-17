import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { buildCrisisResponse, triageCrisis, type CrisisResponse } from "./crisis";
import { QUICK_ACTION_IDS } from "./quick-actions";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "./chat-rate-limit";
import type { CompanionAction } from "./companion-tools.server";

const HISTORY_LIMIT = 20;

const SendInput = z.object({
  thread_id: z.string().uuid().optional(),
  content: z.string().trim().min(1).max(4000),
  quick_action: z.string().refine((value) => QUICK_ACTION_IDS.includes(value)).nullish(),
});

export const listThreads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("chat_threads")
      .select("id, title, created_at, updated_at")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

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

export const getThreadHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ thread_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const [thread, messages] = await Promise.all([
      supabase
        .from("chat_threads")
        .select("id, title, created_at, updated_at")
        .eq("id", data.thread_id)
        .eq("user_id", userId)
        .maybeSingle(),
      supabase
        .from("chat_messages")
        .select("id, sender, content, content_type, exercise_slug, flagged_crisis, quick_action, created_at")
        .eq("thread_id", data.thread_id)
        .eq("user_id", userId)
        .order("created_at", { ascending: true }),
    ]);
    if (thread.error) throw thread.error;
    if (messages.error) throw messages.error;
    if (!thread.data) throw new Error("Thread not found");
    return { thread: thread.data, messages: messages.data ?? [] };
  });

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

export const sendMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => SendInput.parse(input))
  .handler(async ({ data, context }): Promise<SendMessageResult> => {
    const { supabase, userId } = context;

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

    const recentTurns = await supabase
      .from("chat_messages")
      .select("sender, content")
      .eq("thread_id", threadId)
      .eq("user_id", userId)
      .neq("id", savedUser.data.id)
      .order("created_at", { ascending: false })
      .limit(2);

    const { runCrisisGate } = await import("./crisis-gate.server");
    const gated = await runCrisisGate(supabase, {
      userId,
      threadId,
      messageId: savedUser.data.id,
      content: data.content,
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
    // Both crisis checks above have already run and come up clear. ---
    const limit = await checkRateLimit(supabase, userId);
    if (!limit.allowed) {
      const savedLimit = await supabase
        .from("chat_messages")
        .insert({
          thread_id: threadId,
          user_id: userId,
          sender: "system",
          content: RATE_LIMIT_MESSAGE,
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

    // --- Cross-session memory: summarize the thread they just left, once ---
    const { ensureThreadSummary, fetchRecentSummaries, findPreviousThread } = await import(
      "./thread-summary.server"
    );
    try {
      const previousThreadId = await findPreviousThread(supabase, userId, threadId);
      if (previousThreadId) {
        await ensureThreadSummary(supabase, userId, previousThreadId);
      }
    } catch (error) {
      console.error("thread summary step failed", error);
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


    // Make tool-driven actions visible in the transcript, never silent.
    const actionLines = reply.actions.map((action) => `• ${action.summary}`);
    const replyText = actionLines.length
      ? `${reply.text}\n\n${actionLines.join("\n")}`
      : reply.text;

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
  });
