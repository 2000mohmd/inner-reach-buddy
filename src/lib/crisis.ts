// Crisis-detection middleware shared between server logic and UI rendering.

export type CrisisResource = {
  name: string;
  contact: string;
  detail: string;
};

/**
 * Real severity gradient (Phase 11). Ordered most → least urgent.
 * - critical: explicit method, plan, means, or timeframe
 * - high: clear suicidal / self-harm / harm-to-others ideation, no stated plan
 * - moderate: passive ideation or ambivalent / ambiguous language
 */
export type CrisisSeverity = "critical" | "high" | "moderate";

export const CRISIS_SEVERITY_ORDER: CrisisSeverity[] = ["critical", "high", "moderate"];

export function severityRank(severity: string): number {
  const index = CRISIS_SEVERITY_ORDER.indexOf(severity as CrisisSeverity);
  return index === -1 ? CRISIS_SEVERITY_ORDER.length : index;
}

export type CrisisResponse = {
  type: "crisis";
  severity: CrisisSeverity;
  message: string;
  matched: string[];
  resources: CrisisResource[];
  disclaimer: string;
};

// Tiered pattern list. The tier of the *highest* matching pattern decides the
// severity written to crisis_events; the flat matched-term list is preserved
// for the admin queue.
const CRITICAL_PATTERNS: RegExp[] = [
  /\b(pills|rope|gun|knife|blade|razor|bleach|overdos(e|ing))\b[^.]{0,40}\b(ready|bought|have|got|saved|hidden|loaded)\b/i,
  /\b(ready|bought|have|got|saved|hidden|loaded)\b[^.]{0,40}\b(pills|rope|gun|knife|blade|razor|bleach)\b/i,
  /\b(tonight|today|tomorrow|this\s+(weekend|week|evening)|in\s+an?\s+hour)\b[^.]{0,40}\b(kill|end|die|suicide|overdose|hang|jump)\b/i,
  /\b(kill|end|die|suicide|overdose|hang|jump)\w*\b[^.]{0,40}\b(tonight|today|tomorrow|this\s+(weekend|week|evening)|in\s+an?\s+hour)\b/i,
  /\bi\s+(have|wrote|left)\s+a\s+(note|letter|will)\b/i,
  /\bmy\s+plan\s+is\b/i,
  /\b(i'?m|im|about)\s+(going\s+to|gonna|about\s+to)\s+(kill\s+my ?self|end\s+it|end\s+my\s+life|overdose|hang\s+my ?self|jump)\b/i,
  /\bhang\s+my ?self\b/i,
  /\bloaded\s+(gun|weapon)\b/i,
];

const HIGH_RISK_PATTERNS: RegExp[] = [
  /\bkill(ing)?\s+my ?self\b/i,
  /\bkill\s+(him|her|them|someone|people)\b/i,
  /\bend(ing)?\s+(my|it)\s+(life|all)\b/i,
  /\bend\s+it\s+all\b/i,
  /\btake\s+my\s+own\s+life\b/i,
  /\bsuicid(e|al)\b/i,
  /\bwant\s+to\s+die\b/i,
  /\bdon'?t\s+want\s+to\s+(be\s+alive|live)\b/i,
  /\bno\s+reason\s+to\s+live\b/i,
  /\b(cut|cutting|hurt|hurting|harm|harming)\s+my ?self\b/i,
  /\bself[-\s]?harm\b/i,
  /\boverdos(e|ing)\b/i,
  /\bhurt\s+(someone|somebody|others|people|him|her|them)\b/i,
];

const MODERATE_PATTERNS: RegExp[] = [
  /\bbetter\s+off\s+dead\b/i,
  /\bbetter\s+off\s+without\s+me\b/i,
  /\bwish\s+i\s+(wasn'?t|was\s+not)\s+(here|alive|around|born)\b/i,
  /\bwish\s+i\s+(could\s+)?(disappear|stop\s+existing|not\s+wake\s+up)\b/i,
  /\bdon'?t\s+want\s+to\s+(wake\s+up|be\s+here|exist)\b/i,
  /\bwhat'?s\s+the\s+point\s+of\s+(living|being\s+here|any\s+of\s+it)\b/i,
  /\btired\s+of\s+being\s+alive\b/i,
  /\bnobody\s+would\s+(notice|miss\s+me|care)\s+if\s+i\b/i,
];

const TIERS: { severity: CrisisSeverity; patterns: RegExp[] }[] = [
  { severity: "critical", patterns: CRITICAL_PATTERNS },
  { severity: "high", patterns: HIGH_RISK_PATTERNS },
  { severity: "moderate", patterns: MODERATE_PATTERNS },
];


export const CRISIS_RESOURCES: CrisisResource[] = [
  {
    name: "988 Suicide & Crisis Lifeline (US)",
    contact: "Call or text 988",
    detail: "Free, confidential support 24/7.",
  },
  {
    name: "Crisis Text Line",
    contact: "Text HOME to 741741",
    detail: "Text with a trained crisis counselor, 24/7.",
  },
  {
    name: "Emergency services",
    contact: "Call 911 (or your local emergency number)",
    detail: "If you are in immediate danger, please get help right now.",
  },
  {
    name: "International",
    contact: "findahelpline.com",
    detail: "Find a free helpline anywhere in the world.",
  },
];

export const CRISIS_DISCLAIMER =
  "Kalm is a wellness companion, not a therapist or emergency service. Please reach out to a real person or one of the lines above.";

/**
 * Deterministic regex gate with tiered triage.
 * `matched` empty means no crisis language found; `severity` is null then.
 */
export function triageCrisis(text: string): {
  matched: string[];
  severity: CrisisSeverity | null;
} {
  const matched: string[] = [];
  let severity: CrisisSeverity | null = null;

  for (const tier of TIERS) {
    for (const pattern of tier.patterns) {
      const hit = text.match(pattern);
      if (hit) {
        matched.push(hit[0].toLowerCase());
        if (!severity) severity = tier.severity;
      }
    }
  }

  return { matched: [...new Set(matched)], severity };
}

/** Returns the matched crisis phrases; empty array means no crisis language found. */
export function detectCrisis(text: string): string[] {
  return triageCrisis(text).matched;
}

export function buildCrisisResponse(
  matched: string[],
  severity: CrisisSeverity = "high",
): CrisisResponse {
  return {
    type: "crisis",
    severity,
    message:
      "Thank you for telling me. What you just shared sounds really heavy, and I'm glad you said it out loud rather than carrying it alone. I'm not able to keep this part of the conversation going on my own, because you deserve support from someone trained for moments like this — right now. You are not in trouble, and you have not done anything wrong.",
    matched,
    resources: CRISIS_RESOURCES,
    disclaimer: CRISIS_DISCLAIMER,
  };
}

