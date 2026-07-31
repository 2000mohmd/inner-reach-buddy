// Crisis-detection middleware shared between server logic and UI rendering.

export type CrisisResource = {
  name: string;
  contact: string;
  detail: string;
};

export type CrisisResponse = {
  type: "crisis";
  severity: "high";
  message: string;
  matched: string[];
  resources: CrisisResource[];
  disclaimer: string;
};

const HIGH_RISK_PATTERNS: RegExp[] = [
  /\bkill(ing)?\s+my ?self\b/i,
  /\bkill\s+(him|her|them|someone|people)\b/i,
  /\bend(ing)?\s+(my|it)\s+(life|all)\b/i,
  /\bend\s+it\s+all\b/i,
  /\btake\s+my\s+own\s+life\b/i,
  /\bsuicid(e|al)\b/i,
  /\bwant\s+to\s+die\b/i,
  /\bbetter\s+off\s+dead\b/i,
  /\bdon'?t\s+want\s+to\s+(be\s+alive|live)\b/i,
  /\bno\s+reason\s+to\s+live\b/i,
  /\b(cut|cutting|hurt|hurting|harm|harming)\s+my ?self\b/i,
  /\bself[-\s]?harm\b/i,
  /\boverdos(e|ing)\b/i,
  /\bhang\s+my ?self\b/i,
  /\bhurt\s+(someone|somebody|others|people|him|her|them)\b/i,
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

/** Returns the matched crisis phrases; empty array means no crisis language found. */
export function detectCrisis(text: string): string[] {
  const matched: string[] = [];
  for (const pattern of HIGH_RISK_PATTERNS) {
    const hit = text.match(pattern);
    if (hit) matched.push(hit[0].toLowerCase());
  }
  return [...new Set(matched)];
}

export function buildCrisisResponse(matched: string[]): CrisisResponse {
  return {
    type: "crisis",
    severity: "high",
    message:
      "Thank you for telling me. What you just shared sounds really heavy, and I'm glad you said it out loud rather than carrying it alone. I'm not able to keep this part of the conversation going on my own, because you deserve support from someone trained for moments like this — right now. You are not in trouble, and you have not done anything wrong.",
    matched,
    resources: CRISIS_RESOURCES,
    disclaimer: CRISIS_DISCLAIMER,
  };
}
