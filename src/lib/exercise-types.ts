export type ExerciseStep = {
  key: string;
  prompt: string;
  input: "text" | "textarea" | "scale_1_10" | "none";
  timer_seconds?: number;
};

export type ExerciseCategory =
  "thought_record" | "behavioral_activation" | "grounding" | "breathing" | "journaling";

export const CATEGORY_LABELS: Record<ExerciseCategory, string> = {
  thought_record: "Thought work",
  behavioral_activation: "Getting moving again",
  grounding: "Grounding",
  breathing: "Breathing",
  journaling: "Journaling",
};

/**
 * Timed/passive exercises render as a self-contained inline widget instead of
 * being narrated one message at a time by the companion.
 */
export const GUIDED_WIDGET_CATEGORIES = ["grounding", "breathing"] as const;

export function isGuidedWidgetCategory(category: string): boolean {
  return (GUIDED_WIDGET_CATEGORIES as readonly string[]).includes(category);
}

export function parseSteps(value: unknown): ExerciseStep[] {
  if (!Array.isArray(value)) return [];
  return value as ExerciseStep[];
}
