// The crisis gate: the regex triage plus the semantic backstop, together with
// everything that must happen when either flags (crisis_events row + admin
// email alert, transcript system message, thread bump).
//
// ORDERING GUARANTEE (Phase 11) — DO NOT REORDER:
// sendMessage MUST call this for every incoming message BEFORE consulting the
// per-user rate limiter. Nothing in this file reads chat_rate_limits, so a
// user who is rate-limited for ordinary chat still always receives the crisis
// response. Any refactor must preserve that property (see the automated test
// in crisis-gate.test.ts).
import type { CrisisResponse } from "./crisis";
import { buildCrisisResponse, triageCrisis } from "./crisis";

type AnyClient = { from: (table: string) => any };

export type CrisisGateResult = {
  crisis: CrisisResponse;
  systemMessage: { id: string; created_at: string };
  /** Whether the user message row had to be updated to flagged_crisis. */
  updatedUserMessage: boolean;
} | null;

async function recordCrisis(
  supabase: AnyClient,
  input: {
    userId: string;
    threadId: string;
    messageId: string;
    source: string;
    severity: "critical" | "high" | "moderate";
    matched: string[];
    notes?: string | null;
  },
): Promise<{ id: string; created_at: string }> {
  const { logCrisisEvent } = await import("./crisis-alert.server");
  await logCrisisEvent(supabase as never, {
    userId: input.userId,
    source: input.source,
    severity: input.severity,
    matchedTerms: input.matched,
    messageId: input.messageId,
    notes: input.notes ?? null,
  });

  const saved = await supabase
    .from("chat_messages")
    .insert({
      thread_id: input.threadId,
      user_id: input.userId,
      sender: "system",
      content: buildCrisisResponse(input.matched, input.severity).message,
      flagged_crisis: true,
    })
    .select("id, created_at")
    .single();
  if (saved.error) throw saved.error;

  await supabase
    .from("chat_threads")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", input.threadId);

  return saved.data;
}

/**
 * Runs the deterministic regex gate first; only when that is clear does it run
 * the semantic backstop (which fails open). Returns null when the message is
 * not a crisis.
 */
export async function runCrisisGate(
  supabase: AnyClient,
  input: {
    userId: string;
    threadId: string;
    messageId: string;
    content: string;
    recentTurns: { sender: string; content: string }[];
  },
): Promise<CrisisGateResult> {
  const triage = triageCrisis(input.content);

  if (triage.matched.length > 0) {
    const severity = triage.severity ?? "high";
    const systemMessage = await recordCrisis(supabase, {
      ...input,
      source: "chat",
      severity,
      matched: triage.matched,
    });
    return {
      crisis: buildCrisisResponse(triage.matched, severity),
      systemMessage,
      updatedUserMessage: false,
    };
  }

  const { classifyCrisisRisk } = await import("./crisis-classifier.server");
  const semantic = await classifyCrisisRisk(input.content, input.recentTurns);
  if (!semantic.flagged) return null;

  const severity = semantic.severity ?? "high";
  await supabase
    .from("chat_messages")
    .update({ flagged_crisis: true })
    .eq("id", input.messageId);

  const systemMessage = await recordCrisis(supabase, {
    ...input,
    source: "semantic_classifier",
    severity,
    matched: [],
    notes: semantic.reason,
  });

  return {
    crisis: buildCrisisResponse([], severity),
    systemMessage,
    updatedUserMessage: true,
  };
}
