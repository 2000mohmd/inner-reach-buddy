import { useState } from "react";
import { Timer } from "lucide-react";
import type { ExerciseStep } from "@/lib/exercise-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useTranslation } from "@/lib/i18n";

const MOOD_SCORES = [1, 2, 3, 4, 5] as const;

export function MoodRow({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (score: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-5 gap-2">
      {MOOD_SCORES.map((sc) => (
        <button
          key={sc}
          type="button"
          onClick={() => onChange(sc)}
          className={`rounded-2xl border px-1 py-3 text-xs ${
            value === sc
              ? "border-primary bg-secondary font-semibold"
              : "border-border bg-card hover:bg-muted"
          }`}
        >
          {t(`onboarding.moods.${sc}`)}
        </button>
      ))}
    </div>
  );
}

function StepField({
  step,
  value,
  onChange,
}: {
  step: ExerciseStep;
  value: string;
  onChange: (next: string) => void;
}) {
  if (step.input === "none") return null;
  if (step.input === "scale_1_10") {
    return (
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 10 }, (_, index) => index + 1).map((number) => (
          <button
            key={number}
            type="button"
            onClick={() => onChange(String(number))}
            className={`size-10 rounded-full border text-sm ${
              value === String(number)
                ? "border-primary bg-secondary font-semibold"
                : "border-border bg-card hover:bg-muted"
            }`}
          >
            {number}
          </button>
        ))}
      </div>
    );
  }
  if (step.input === "text") {
    return (
      <Input value={value} maxLength={300} onChange={(event) => onChange(event.target.value)} />
    );
  }
  return (
    <Textarea
      rows={4}
      maxLength={2000}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export type ExerciseStepPlayerProps = {
  steps: ExerciseStep[];
  /** Called once the person has finished the steps and the mood checks. */
  onComplete: (
    moodBefore: number | null,
    moodAfter: number | null,
    answers: Record<string, string>,
  ) => void;
  saving?: boolean;
  /** Compact styling for the inline-in-chat widget. */
  compact?: boolean;
};

/**
 * Shared step player used by both the Exercises page and the inline chat widget,
 * so there is exactly one implementation of the guided flow.
 */
export function ExerciseStepPlayer({
  steps,
  onComplete,
  saving = false,
  compact = false,
}: ExerciseStepPlayerProps) {
  const { t } = useTranslation();
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [moodBefore, setMoodBefore] = useState<number | null>(null);
  const [moodAfter, setMoodAfter] = useState<number | null>(null);
  const [done, setDone] = useState(false);

  const step = steps[stepIndex];
  const sectionClass = compact
    ? "space-y-4 rounded-2xl border border-border bg-card p-4"
    : "surface-soft space-y-5 p-6";

  if (moodBefore === null && !done) {
    return (
      <section className={sectionClass}>
        <h3 className={compact ? "text-sm font-medium" : "text-lg"}>
          {t("exercisePlayer.beforeStart")}
        </h3>
        <MoodRow value={moodBefore} onChange={setMoodBefore} />
        <button
          type="button"
          className="text-sm text-muted-foreground underline underline-offset-4"
          onClick={() => setMoodBefore(3)}
        >
          {t("exercisePlayer.skipThis")}
        </button>
      </section>
    );
  }

  if (done) {
    return (
      <section className={sectionClass}>
        <h3 className={compact ? "text-sm font-medium" : "text-lg"}>
          {t("exercisePlayer.afterStart")}
        </h3>
        <p className="text-sm text-muted-foreground">{t("exercisePlayer.afterOptional")}</p>
        <MoodRow value={moodAfter} onChange={setMoodAfter} />
        <div className="flex flex-wrap gap-3">
          <Button
            className="rounded-full px-6"
            disabled={saving}
            onClick={() => onComplete(moodBefore, moodAfter, answers)}
          >
            {saving ? t("common.saving") : t("exercisePlayer.finish")}
          </Button>
          <Button
            variant="ghost"
            className="rounded-full"
            disabled={saving}
            onClick={() => {
              setMoodAfter(null);
              onComplete(moodBefore, null, answers);
            }}
          >
            {t("exercisePlayer.finishNoMood")}
          </Button>
        </div>
      </section>
    );
  }

  if (!step) return null;

  return (
    <section className={sectionClass}>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {t("exercisePlayer.stepOf", { current: stepIndex + 1, total: steps.length })}
      </p>
      <p className={compact ? "text-sm leading-relaxed" : "text-lg"}>{step.prompt}</p>
      {step.timer_seconds ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Timer className="size-4" aria-hidden />{" "}
          {t("exercisePlayer.takeSeconds", { seconds: step.timer_seconds })}
        </p>
      ) : null}
      <StepField
        step={step}
        value={answers[step.key] ?? ""}
        onChange={(next) => setAnswers((prev) => ({ ...prev, [step.key]: next }))}
      />
      <div className="flex gap-3">
        {stepIndex > 0 && (
          <Button
            variant="outline"
            className="rounded-full"
            onClick={() => setStepIndex((index) => index - 1)}
          >
            {t("common.back")}
          </Button>
        )}
        <Button
          className="rounded-full px-6"
          onClick={() => {
            if (stepIndex + 1 < steps.length) setStepIndex((index) => index + 1);
            else setDone(true);
          }}
        >
          {stepIndex + 1 < steps.length ? t("common.next") : t("exercisePlayer.doneBtn")}
        </Button>
      </div>
    </section>
  );
}
