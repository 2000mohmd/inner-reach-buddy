// Lightweight "react to something that just happened" path. Reuses the same
// model machinery and system prompt as chat, but with no tools — it is a
// one-shot reaction, not a conversation turn. Crisis handling is untouched:
// nothing here inspects or bypasses detectCrisis.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { buildSystemPrompt, type CompanionContext } from "./ai-companion.server";
import { callCompanionModel } from "./llm-provider.server";

type Client = SupabaseClient<Database>;

const MODEL = "claude-sonnet-5";
const MAX_TOKENS = 400;

function baseContext(overrides: Partial<CompanionContext>): CompanionContext {
  return {
    preferredName: null,
    accountType: null,
    introText: null,
    goals: [],
    stressors: [],
    communicationPreference: null,
    topicsToAvoid: null,
    inProfessionalCare: false,
    recentMoods: [],
    history: [],
    quickAction: null,
    ...overrides,
  };
}

/** Generates one short, warm reaction sentence or two. Returns null on failure. */
export async function generateReaction(
  instruction: string,
  overrides: Partial<CompanionContext> = {},
): Promise<string | null> {
  try {
    const payload = await callCompanionModel({
      model: MODEL,
      maxTokens: MAX_TOKENS,
      system: buildSystemPrompt(baseContext(overrides)),
      messages: [
        {
          role: "user",
          content: [
            "You are reacting to something the person just did in the app — they did not send you a message.",
            "Rules: 1-3 sentences. Warm and specific to what they actually did. No bullet points, no headings, no sign-off, no advice lists, no new exercise suggestions unless it's a single natural offer.",
            "",
            instruction,
          ].join("\n"),
        },
      ],
      tools: [],
    });
    const text = (payload.content ?? [])
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
    return text || null;
  } catch (error) {
    console.error("companion reaction failed", error);
    return null;
  }
}

/** Finds the most recently active thread for a person, creating one if needed. */
export async function resolveActiveThread(
  supabase: Client,
  userId: string,
): Promise<string | null> {
  const existing = await supabase
    .from("chat_threads")
    .select("id")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing.data?.id) return existing.data.id;

  const created = await supabase
    .from("chat_threads")
    .insert({ user_id: userId, title: "Your activity" })
    .select("id")
    .single();
  if (created.error) {
    console.error("could not create thread for activity", created.error);
    return null;
  }
  return created.data.id;
}

export type ActivityPost = {
  supabase: Client;
  userId: string;
  threadId?: string | null;
  /** Compact card text, e.g. "Completed Box Breathing · mood 2 → 4". */
  activityLabel: string;
  /** Instruction for the reaction; when null, no reaction is generated. */
  reactionInstruction: string | null;
  preferredName?: string | null;
};

/**
 * Drops a compact activity card into the person's active thread and, when
 * there's something meaningful to react to, a warm companion reply after it.
 */
export async function postActivityToChat({
  supabase,
  userId,
  threadId,
  activityLabel,
  reactionInstruction,
  preferredName = null,
}: ActivityPost): Promise<{ thread_id: string | null }> {
  const resolved = threadId ?? (await resolveActiveThread(supabase, userId));
  if (!resolved) return { thread_id: null };

  const activity = await supabase.from("chat_messages").insert({
    thread_id: resolved,
    user_id: userId,
    sender: "system",
    content_type: "activity",
    content: activityLabel,
  });
  if (activity.error) {
    console.error("activity message insert failed", activity.error);
    return { thread_id: resolved };
  }

  if (reactionInstruction) {
    const text = await generateReaction(reactionInstruction, { preferredName });
    if (text) {
      const saved = await supabase.from("chat_messages").insert({
        thread_id: resolved,
        user_id: userId,
        sender: "assistant",
        content_type: "text",
        content: text,
      });
      if (saved.error) console.error("reaction message insert failed", saved.error);
    }
  }

  await supabase
    .from("chat_threads")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", resolved);

  return { thread_id: resolved };
}
