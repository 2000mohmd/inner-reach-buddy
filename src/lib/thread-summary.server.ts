// Cross-session memory: short summaries of past conversations so the companion
// can pick up where it left off. Uses its own tiny, single-purpose Claude call —
// not the full companion system prompt — and never touches crisis handling.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { callCompanionModel } from "./llm-provider.server";

type Client = SupabaseClient<Database>;

const SUMMARY_MODEL = "claude-sonnet-5";
const SUMMARY_MAX_TOKENS = 300;
const SUMMARY_SYSTEM =
  "You write short private continuity notes about a wellness conversation, for the companion's own reference next time. Write 2-4 sentences covering: what was discussed, the person's emotional tone, and anything they said they would try. Plain prose, no headings, no bullets, no advice, no diagnosis, no quotes longer than a few words.";

export type ThreadSummaryRecord = {
  summary_text: string;
  created_at: string;
  open_commitment_ids: string[] | null;
};

/** The user's most recently active thread other than the current one. */
export async function findPreviousThread(
  supabase: Client,
  userId: string,
  currentThreadId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("chat_threads")
    .select("id")
    .eq("user_id", userId)
    .neq("id", currentThreadId)
    .order("updated_at", { ascending: false })
    .limit(1);
  return data?.[0]?.id ?? null;
}

/**
 * Summarizes a thread once. No-ops when a summary already exists, the thread
 * is too short to be worth remembering, or the model call fails.
 */
export async function ensureThreadSummary(
  supabase: Client,
  userId: string,
  threadId: string,
): Promise<void> {
  const existing = await supabase
    .from("thread_summaries")
    .select("id")
    .eq("thread_id", threadId)
    .maybeSingle();
  if (existing.error || existing.data) return;

  const [messages, commitments] = await Promise.all([
    supabase
      .from("chat_messages")
      .select("sender, content")
      .eq("thread_id", threadId)
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(40),
    supabase
      .from("commitments")
      .select("id, description, status")
      .eq("user_id", userId)
      .eq("thread_id", threadId),
  ]);

  const transcript = (messages.data ?? []).filter((entry) => entry.sender !== "system");
  if (transcript.length < 2) return;

  const openCommitments = (commitments.data ?? []).filter((row) => row.status === "pending");
  const commitmentLine = openCommitments.length
    ? `\n\nThings they committed to: ${openCommitments.map((row) => row.description).join("; ")}.`
    : "";

  let summaryText = "";
  try {
    const payload = await callCompanionModel({
      model: SUMMARY_MODEL,
      maxTokens: SUMMARY_MAX_TOKENS,
      system: SUMMARY_SYSTEM,
      messages: [
        {
          role: "user",
          content: `Conversation transcript:\n${transcript
            .map(
              (entry) =>
                `${entry.sender === "assistant" ? "Companion" : "Person"}: ${entry.content}`,
            )
            .join("\n")}${commitmentLine}`,
        },
      ],
    });
    summaryText = payload.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
  } catch (error) {
    console.error("thread summary call failed", error);
    return;
  }

  if (!summaryText) return;

  const { error } = await supabase.from("thread_summaries").insert({
    user_id: userId,
    thread_id: threadId,
    summary_text: summaryText.slice(0, 2000),
    open_commitment_ids: openCommitments.length ? openCommitments.map((row) => row.id) : null,
  });
  if (error) console.error("thread summary insert failed", error);
}

/** Most recent summaries from other threads, with commitment follow-through. */
export async function fetchRecentSummaries(
  supabase: Client,
  userId: string,
  currentThreadId: string,
  limit = 2,
): Promise<{ summary: string; when: string; commitmentNote: string | null }[]> {
  const { data } = await supabase
    .from("thread_summaries")
    .select("summary_text, created_at, open_commitment_ids, thread_id")
    .eq("user_id", userId)
    .neq("thread_id", currentThreadId)
    .order("created_at", { ascending: false })
    .limit(limit);

  const rows = data ?? [];
  if (rows.length === 0) return [];

  const ids = rows.flatMap((row) => row.open_commitment_ids ?? []);
  const commitmentsById = new Map<string, { description: string; status: string }>();
  if (ids.length) {
    const { data: commitments } = await supabase
      .from("commitments")
      .select("id, description, status")
      .eq("user_id", userId)
      .in("id", ids);
    for (const row of commitments ?? []) {
      commitmentsById.set(row.id, { description: row.description, status: row.status });
    }
  }

  return rows.map((row) => {
    const linked = (row.open_commitment_ids ?? [])
      .map((id) => commitmentsById.get(id))
      .filter((entry): entry is { description: string; status: string } => Boolean(entry));
    const commitmentNote = linked.length
      ? linked
          .map(
            (entry) =>
              `"${entry.description}" — ${
                entry.status === "done"
                  ? "they marked this done"
                  : entry.status === "skipped"
                    ? "they skipped this"
                    : "still open"
              }`,
          )
          .join("; ")
      : null;
    return {
      summary: row.summary_text,
      when: new Date(row.created_at).toISOString().slice(0, 10),
      commitmentNote,
    };
  });
}
