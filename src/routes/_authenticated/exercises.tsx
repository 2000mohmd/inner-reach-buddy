import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Clock, Timer } from "lucide-react";
import { completeExercise, listExercises } from "@/lib/exercises.functions";
import {
  CATEGORY_LABELS,
  parseSteps,
  type ExerciseCategory,
  type ExerciseStep,
} from "@/lib/exercise-types";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/exercises")({
  head: () => ({
    meta: [
      { title: "Guided exercises — Kalm" },
      {
        name: "description",
        content:
          "Work through CBT thought records, behavioral activation, grounding, box breathing and worry-time journaling at your own pace.",
      },
      { property: "og:title", content: "Guided exercises — Kalm" },
      {
        property: "og:description",
        content:
          "Evidence-based exercises — thought records, behavioral activation, grounding, breathing and worry time.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ExercisesPage,
});

const MOODS = [
  { score: 1, label: "Really low" },
  { score: 2, label: "Low" },
  { score: 3, label: "Okay" },
  { score: 4, label: "Good" },
  { score: 5, label: "Great" },
];

function MoodRow({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (score: number) => void;
}) {
  return (
    <div className="grid grid-cols-5 gap-2">
      {MOODS.map((mood) => (
        <button
          key={mood.score}
          type="button"
          onClick={() => onChange(mood.score)}
          className={`rounded-2xl border px-1 py-3 text-xs ${
            value === mood.score
              ? "border-primary bg-secondary font-semibold"
              : "border-border bg-card hover:bg-muted"
          }`}
        >
          {mood.label}
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

function ExercisesPage() {
  const queryClient = useQueryClient();
  const fetchExercises = useServerFn(listExercises);
  const finish = useServerFn(completeExercise);

  const { data, isPending } = useQuery({
    queryKey: ["exercises"],
    queryFn: () => fetchExercises(),
  });

  const [activeId, setActiveId] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [moodBefore, setMoodBefore] = useState<number | null>(null);
  const [moodAfter, setMoodAfter] = useState<number | null>(null);
  const [done, setDone] = useState(false);

  const active = useMemo(
    () => data?.exercises.find((exercise) => exercise.id === activeId) ?? null,
    [activeId, data],
  );
  const steps = active ? parseSteps(active.steps) : [];

  function reset() {
    setActiveId(null);
    setStepIndex(0);
    setAnswers({});
    setMoodBefore(null);
    setMoodAfter(null);
    setDone(false);
  }

  const save = useMutation({
    mutationFn: () =>
      finish({
        data: {
          exercise_id: activeId as string,
          mood_before: moodBefore,
          mood_after: moodAfter,
          response_data: answers,
          log_mood_after: true,
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["exercises"] });
      await queryClient.invalidateQueries({ queryKey: ["my-profile"] });
      toast.success("Saved. Thanks for taking the time.");
      reset();
    },
    onError: () => toast.error("We couldn't save that. Please try again."),
  });

  if (isPending) {
    return (
      <AppShell>
        <div className="space-y-4">
          <Skeleton className="h-10 w-56" />
          <Skeleton className="h-64 w-full rounded-3xl" />
        </div>
      </AppShell>
    );
  }

  if (active) {
    const step = steps[stepIndex];
    return (
      <AppShell>
        <div className="mx-auto max-w-2xl space-y-6">
          <Button variant="ghost" className="rounded-full" onClick={reset}>
            <ArrowLeft className="size-4" aria-hidden /> Back to exercises
          </Button>

          <header>
            <h1 className="text-2xl sm:text-3xl">{active.title}</h1>
            <p className="mt-2 text-muted-foreground">{active.intro_text}</p>
          </header>

          {moodBefore === null && !done ? (
            <section className="surface-soft space-y-4 p-6">
              <h2 className="text-lg">Before we start — how are you feeling?</h2>
              <MoodRow value={moodBefore} onChange={setMoodBefore} />
              <button
                type="button"
                className="text-sm text-muted-foreground underline underline-offset-4"
                onClick={() => setMoodBefore(3)}
              >
                Skip this
              </button>
            </section>
          ) : done ? (
            <section className="surface-soft space-y-4 p-6">
              <h2 className="text-lg">And how are you feeling now?</h2>
              <p className="text-sm text-muted-foreground">
                Optional — this feeds into your mood trend so patterns show up over time.
              </p>
              <MoodRow value={moodAfter} onChange={setMoodAfter} />
              <div className="flex flex-wrap gap-3">
                <Button
                  className="rounded-full px-6"
                  disabled={save.isPending}
                  onClick={() => save.mutate()}
                >
                  {save.isPending ? "Saving…" : "Finish"}
                </Button>
                <Button
                  variant="ghost"
                  className="rounded-full"
                  disabled={save.isPending}
                  onClick={() => {
                    setMoodAfter(null);
                    save.mutate();
                  }}
                >
                  Finish without mood check
                </Button>
              </div>
            </section>
          ) : (
            step && (
              <section className="surface-soft space-y-5 p-6">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Step {stepIndex + 1} of {steps.length}
                </p>
                <p className="text-lg">{step.prompt}</p>
                {step.timer_seconds ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Timer className="size-4" aria-hidden /> Take about {step.timer_seconds} seconds
                    here.
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
                      Back
                    </Button>
                  )}
                  <Button
                    className="rounded-full px-6"
                    onClick={() => {
                      if (stepIndex + 1 < steps.length) setStepIndex((index) => index + 1);
                      else setDone(true);
                    }}
                  >
                    {stepIndex + 1 < steps.length ? "Next" : "Done"}
                  </Button>
                </div>
              </section>
            )
          )}
        </div>
      </AppShell>
    );
  }

  const completions = data?.completions ?? [];

  return (
    <AppShell>
      <div className="space-y-8">
        <header>
          <h1 className="text-3xl sm:text-4xl">Guided exercises</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            These follow established protocols — thought records, behavioral activation, grounding,
            breathing and contained worry time. Nothing here is a treatment plan; use what helps.
          </p>
        </header>

        <section className="grid gap-4 sm:grid-cols-2">
          {(data?.exercises ?? []).map((exercise) => (
            <button
              key={exercise.id}
              type="button"
              onClick={() => {
                reset();
                setActiveId(exercise.id);
              }}
              className="surface-soft p-6 text-left transition hover:bg-muted/40"
            >
              <p className="text-xs uppercase tracking-wide text-primary">
                {CATEGORY_LABELS[exercise.category as ExerciseCategory] ?? exercise.category}
              </p>
              <h2 className="mt-2 text-lg">{exercise.title}</h2>
              <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">
                {exercise.intro_text}
              </p>
              <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="size-3.5" aria-hidden /> about {exercise.estimated_minutes} min
              </p>
            </button>
          ))}
        </section>

        {completions.length > 0 && (
          <section className="surface-soft p-6">
            <h2 className="text-lg">Recently completed</h2>
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
              {completions.slice(0, 6).map((completion) => {
                const exercise = data?.exercises.find((row) => row.id === completion.exercise_id);
                const shift =
                  completion.mood_before !== null && completion.mood_after !== null
                    ? completion.mood_after - completion.mood_before
                    : null;
                return (
                  <li key={completion.id}>
                    {exercise?.title ?? "Exercise"} —{" "}
                    {new Date(completion.completed_at).toLocaleDateString()}
                    {shift !== null && (
                      <span>
                        {" "}
                        · mood {shift > 0 ? `up ${shift}` : shift < 0 ? `down ${-shift}` : "steady"}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </AppShell>
  );
}
