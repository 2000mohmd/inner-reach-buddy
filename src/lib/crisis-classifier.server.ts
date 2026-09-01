// Semantic crisis backstop. This runs ONLY after the deterministic regex gate
// (triageCrisis) has found nothing — regex stays the fast, guaranteed first
// check. This is an extra net underneath it for implicit or coded language.
//
// Fails open on any error: a broken classifier must never block chat.
import { callCompanionModel } from "./llm-provider.server";
import type { CrisisSeverity } from "./crisis";

const CLASSIFIER_MODEL = "claude-haiku-4-5";
const CLASSIFIER_MAX_TOKENS = 120;

const SEVERITY_RUBRIC = `Severity tiers:
- critical: an explicit method, means, plan, or timeframe is mentioned.
- high: clear suicidal ideation, self-harm intent, or intent to harm someone else, without a specific plan.
- moderate: passive ideation (e.g. "sometimes I wish I wasn't here") or ambiguous / ambivalent language.`;

const CLASSIFIER_SYSTEM = `You are a safety classifier for a mental wellness app. You do not talk to the user.

Question: does the latest message suggest the person may be expressing suicidal ideation, self-harm, or intent to harm someone else — even implicitly, indirectly, or through coded language (e.g. "I just want to stop existing", "everyone would be fine without me", "I've been thinking about not being here")?

${SEVERITY_RUBRIC}

Answer in exactly this format, nothing else:
yes | <critical|high|moderate> — <one short reason>
or
no | none — <one short reason>

Be careful in both directions: do not flag ordinary sadness, frustration, exhaustion, or figures of speech ("this is killing me", "I'm dead tired"), but do flag genuine implicit signals.`;

const DRIFT_SYSTEM = `You are a safety classifier for a mental wellness app. You do not talk to the user.

You are given a whole conversation, already finished. Individual messages did not trip the per-message safety checks. Question: does the overall arc of this conversation — the trajectory, escalation, hopelessness, withdrawal, or narrowing of options across turns — suggest concerning risk of suicide, self-harm, or harm to others, even though no single message did?

${SEVERITY_RUBRIC}

Answer in exactly this format, nothing else:
yes | <critical|high|moderate> — <one short reason>
or
no | none — <one short reason>

Only flag a genuine risk trajectory. Ordinary venting, a hard day, or steady low mood that stays stable is not a flag.`;

export type SemanticCrisisResult = {
  flagged: boolean;
  severity: CrisisSeverity | null;
  reason: string | null;
  /**
   * True when the classifier itself errored and we returned "not flagged"
   * without an actual verdict. The crisis gate uses this to fail SAFE for
   * non-English messages, where the regex tier is a weaker net.
   */
  failedOpen?: boolean;
};

const NOT_FLAGGED: SemanticCrisisResult = { flagged: false, severity: null, reason: null };

const CLASSIFIER_ERROR: SemanticCrisisResult = {
  flagged: false,
  severity: null,
  reason: "classifier_unavailable",
  failedOpen: true,
};

function parseVerdict(text: string): SemanticCrisisResult {
  const flagged = /^\s*yes\b/i.test(text);
  if (!flagged) return NOT_FLAGGED;

  const tier = text.match(/\b(critical|high|moderate)\b/i)?.[1]?.toLowerCase() as
    CrisisSeverity | undefined;
  const reason =
    text.replace(/^\s*yes\s*[|]?\s*(critical|high|moderate|none)?\s*[—\-:]*\s*/i, "").trim() ||
    null;

  return { flagged: true, severity: tier ?? "high", reason };
}

const MULTILINGUAL_NOTE = `The person may write in English, Arabic (including Levantine or Gulf colloquial) or French, and may mix languages within one message. Judge the meaning in whatever language they used, applying exactly the same thresholds — never treat a non-English message as lower risk because it is harder to read. Always answer in the English format specified above.`;

async function classify(system: string, userContent: string): Promise<SemanticCrisisResult> {
  try {
    const payload = await callCompanionModel({
      model: CLASSIFIER_MODEL,
      maxTokens: CLASSIFIER_MAX_TOKENS,
      system: `${system}\n\n${MULTILINGUAL_NOTE}`,
      messages: [{ role: "user", content: userContent }],
    });

    const text = payload.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join(" ")
      .trim();

    return parseVerdict(text);
  } catch (error) {
    // Fail open — log and let the normal conversation continue.
    console.error("semantic crisis classifier failed", error);
    return CLASSIFIER_ERROR;
  }
}

/**
 * @param message the current user message
 * @param recentTurns up to the last 1-2 turns, oldest first, for context only
 */
export async function classifyCrisisRisk(
  message: string,
  recentTurns: { sender: string; content: string }[] = [],
): Promise<SemanticCrisisResult> {
  const context = recentTurns
    .slice(-2)
    .map((turn) => `${turn.sender === "assistant" ? "Companion" : "Person"}: ${turn.content}`)
    .join("\n");

  return classify(
    CLASSIFIER_SYSTEM,
    [context ? `Recent context:\n${context}\n` : "", `Latest message from the person:\n${message}`]
      .filter(Boolean)
      .join("\n"),
  );
}

/**
 * Session-level drift sweep. Runs when a thread is summarized (i.e. after it
 * closes) over the FULL transcript — a slower, complementary net that catches
 * risk building gradually across turns. Never a replacement for the
 * per-message regex gate or semantic backstop.
 */
export async function classifySessionDrift(
  transcript: { sender: string; content: string }[],
): Promise<SemanticCrisisResult> {
  if (transcript.length < 4) return NOT_FLAGGED;

  const rendered = transcript
    .slice(-40)
    .map((turn) => `${turn.sender === "assistant" ? "Companion" : "Person"}: ${turn.content}`)
    .join("\n");

  return classify(DRIFT_SYSTEM, `Full conversation:\n${rendered}`);
}
