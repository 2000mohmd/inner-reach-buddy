const SEVERITY_STYLES: Record<string, string> = {
  critical: "border-crisis/60 bg-crisis-surface text-crisis",
  high: "border-crisis/30 bg-crisis-surface/60 text-crisis",
  moderate: "border-border bg-muted text-muted-foreground",
};

/** Shared severity chip used by the crisis queue and the admin user detail page. */
export function CrisisSeverityBadge({ severity }: { severity: string }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
        SEVERITY_STYLES[severity] ?? SEVERITY_STYLES["moderate"]
      }`}
    >
      {severity}
    </span>
  );
}

export const CRISIS_SOURCE_LABELS: Record<string, string> = {
  chat: "Chat (regex gate)",
  phq9_item9: "PHQ-9 item 9",
  semantic_classifier: "Semantic backstop",
  session_drift_sweep: "Session drift sweep",
};
