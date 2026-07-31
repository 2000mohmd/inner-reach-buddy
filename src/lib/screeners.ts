// PHQ-9 and GAD-7: public-domain validated screening instruments.

export type ScreenerType = "phq9" | "gad7";

export const SCREENER_CHOICES = [
  { value: 0, label: "Not at all" },
  { value: 1, label: "Several days" },
  { value: 2, label: "More than half the days" },
  { value: 3, label: "Nearly every day" },
] as const;

export const SCREENER_FRAMING =
  "This helps you and me notice patterns over time — it's not a diagnosis.";

export const SCREENER_INTERVAL_DAYS = 14;

export const PHQ9_ITEMS = [
  "Little interest or pleasure in doing things",
  "Feeling down, depressed, or hopeless",
  "Trouble falling or staying asleep, or sleeping too much",
  "Feeling tired or having little energy",
  "Poor appetite or overeating",
  "Feeling bad about yourself — or that you are a failure or have let yourself or your family down",
  "Trouble concentrating on things, such as reading the newspaper or watching television",
  "Moving or speaking so slowly that other people could have noticed — or the opposite, being fidgety or restless",
  "Thoughts that you would be better off dead or of hurting yourself in some way",
];

export const GAD7_ITEMS = [
  "Feeling nervous, anxious, or on edge",
  "Not being able to stop or control worrying",
  "Worrying too much about different things",
  "Trouble relaxing",
  "Being so restless that it is hard to sit still",
  "Becoming easily annoyed or irritable",
  "Feeling afraid, as if something awful might happen",
];

export const SCREENERS: Record<
  ScreenerType,
  { label: string; prompt: string; items: string[] }
> = {
  phq9: {
    label: "PHQ-9 (low mood)",
    prompt: "Over the last 2 weeks, how often have you been bothered by any of the following?",
    items: PHQ9_ITEMS,
  },
  gad7: {
    label: "GAD-7 (anxiety)",
    prompt: "Over the last 2 weeks, how often have you been bothered by the following?",
    items: GAD7_ITEMS,
  },
};

/** Standard severity bands. Band index rises with severity. */
export const SEVERITY_BANDS = [
  "minimal",
  "mild",
  "moderate",
  "moderately severe",
  "severe",
] as const;

export type Severity = (typeof SEVERITY_BANDS)[number];

export function scoreSeverity(type: ScreenerType, total: number): Severity {
  if (type === "phq9") {
    if (total <= 4) return "minimal";
    if (total <= 9) return "mild";
    if (total <= 14) return "moderate";
    if (total <= 19) return "moderately severe";
    return "severe";
  }
  // GAD-7 has three cut-points; map onto the shared band list.
  if (total <= 4) return "minimal";
  if (total <= 9) return "mild";
  if (total <= 14) return "moderate";
  return "severe";
}

export function severityIndex(severity: string): number {
  const index = SEVERITY_BANDS.indexOf(severity as Severity);
  return index === -1 ? 0 : index;
}

export function maxScore(type: ScreenerType): number {
  return SCREENERS[type].items.length * 3;
}
