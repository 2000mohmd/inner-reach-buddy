import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Clock } from "lucide-react";
import { completeExercise, listExercises } from "@/lib/exercises.functions";
import { parseSteps } from "@/lib/exercise-types";
import { ExerciseStepPlayer } from "@/components/ExerciseStepPlayer";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "@/lib/i18n";

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

function ExercisesPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const fetchExercises = useServerFn(listExercises);
  const finish = useServerFn(completeExercise);

  const { data, isPending } = useQuery({
    queryKey: ["exercises"],
    queryFn: () => fetchExercises(),
  });

  const [activeId, setActiveId] = useState<string | null>(null);

  const active = useMemo(
    () => data?.exercises.find((exercise) => exercise.id === activeId) ?? null,
    [activeId, data],
  );
  const steps = active ? parseSteps(active.steps) : [];

  function reset() {
    setActiveId(null);
  }

  const save = useMutation({
    mutationFn: (payload: {
      moodBefore: number | null;
      moodAfter: number | null;
      answers: Record<string, string>;
    }) =>
      finish({
        data: {
          exercise_id: activeId as string,
          mood_before: payload.moodBefore,
          mood_after: payload.moodAfter,
          response_data: payload.answers,
          log_mood_after: true,
        },
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["exercises"] });
      await queryClient.invalidateQueries({ queryKey: ["my-profile"] });
      toast.success(t("exercisesPage.saved"));
      reset();
    },
    onError: () => toast.error(t("exercisesPage.saveFailed")),
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
    return (
      <AppShell>
        <div className="mx-auto max-w-2xl space-y-6">
          <Button variant="ghost" className="rounded-full" onClick={reset}>
            <ArrowLeft className="size-4" aria-hidden /> {t("exercisesPage.backToExercises")}
          </Button>

          <header>
            <h1 className="text-2xl sm:text-3xl">{active.title}</h1>
            <p className="mt-2 text-muted-foreground">{active.intro_text}</p>
          </header>

          <ExerciseStepPlayer
            key={active.id}
            steps={steps}
            saving={save.isPending}
            onComplete={(moodBefore, moodAfter, answers) =>
              save.mutate({ moodBefore, moodAfter, answers })
            }
          />
        </div>
      </AppShell>
    );
  }

  const completions = data?.completions ?? [];

  return (
    <AppShell>
      <div className="space-y-8">
        <header>
          <h1 className="text-3xl sm:text-4xl">{t("exercisesPage.title")}</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">{t("exercisesPage.subtitle")}</p>
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
                {t(`exerciseCategory.${exercise.category}`)}
              </p>
              <h2 className="mt-2 text-lg">{exercise.title}</h2>
              <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">
                {exercise.intro_text}
              </p>
              <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="size-3.5" aria-hidden />{" "}
                {t("exercisesPage.aboutMin", { min: exercise.estimated_minutes })}
              </p>
            </button>
          ))}
        </section>

        {completions.length > 0 && (
          <section className="surface-soft p-6">
            <h2 className="text-lg">{t("exercisesPage.recentlyCompleted")}</h2>
            <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
              {completions.slice(0, 6).map((completion) => {
                const exercise = data?.exercises.find((row) => row.id === completion.exercise_id);
                const shift =
                  completion.mood_before !== null && completion.mood_after !== null
                    ? completion.mood_after - completion.mood_before
                    : null;
                return (
                  <li key={completion.id}>
                    {exercise?.title ?? t("exercisesPage.exerciseFallback")} —{" "}
                    {new Date(completion.completed_at).toLocaleDateString()}
                    {shift !== null && (
                      <span>
                        {" "}
                        ·{" "}
                        {shift > 0
                          ? t("exercisesPage.moodUp", { n: shift })
                          : shift < 0
                            ? t("exercisesPage.moodDown", { n: -shift })
                            : t("exercisesPage.moodSteady")}
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
