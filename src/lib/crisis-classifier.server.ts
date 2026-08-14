// Semantic crisis backstop. This runs ONLY after the deterministic regex gate
// (detectCrisis) has found nothing — regex stays the fast, guaranteed first
// check. This is an extra net underneath it for implicit or coded language.
//
// Fails open on any error: a broken classifier must never block chat.
import { callCompanionModel } from "./llm-provider.server";

const CLASSIFIER_MODEL = "claude-haiku-4-5";
const CLASSIFIER_MAX_TOKENS = 100;

const CLASSIFIER_SYSTEM = `You are a safety classifier for a mental wellness app. You do not talk to the user.

Question: does the latest message suggest the person may be expressing suicidal ideation, self-harm, or intent to harm someone else — even implicitly, indirectly, or through coded language (e.g. "I just want to stop existing", "everyone would be fine without me", "I've been thinking about not being here")?

Answer in exactly this format, nothing else:
yes — <one short reason>
or
no — <one short reason>

Be careful in both directions: do not flag ordinary sadness, frustration, exhaustion, or figures of speech ("this is killing me", "I'm dead tired"), but do flag genuine implicit signals.`;

export type SemanticCrisisResult = { flagged: boolean; reason: string | null };

/**
 * @param message the current user message
 * @param recentTurns up to the last 1-2 turns, oldest first, for context only
 */
export async function classifyCrisisRisk(
  message: string,
  recentTurns: { sender: string; content: string }[] = [],
): Promise<SemanticCrisisResult> {
  try {
    const context = recentTurns
      .slice(-2)
      .map((turn) => `${turn.sender === "assistant" ? "Companion" : "Person"}: ${turn.content}`)
      .join("\n");

    const payload = await callCompanionModel({
      model: CLASSIFIER_MODEL,
      maxTokens: CLASSIFIER_MAX_TOKENS,
      system: CLASSIFIER_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            context ? `Recent context:\n${context}\n` : "",
            `Latest message from the person:\n${message}`,
          ]
            .filter(Boolean)
            .join("\n"),
        },
      ],
    });

    const text = payload.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join(" ")
      .trim();

    const flagged = /^\s*yes\b/i.test(text);
    const reason = text.replace(/^\s*(yes|no)\s*[—\-:]*\s*/i, "").trim() || null;
    return { flagged, reason: flagged ? reason : null };
  } catch (error) {
    // Fail open — log and let the normal conversation continue.
    console.error("semantic crisis classifier failed", error);
    return { flagged: false, reason: null };
  }
}
