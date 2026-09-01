import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { completeExercise, getExerciseBySlug } from "@/lib/exercises.functions";
import { parseSteps } from "@/lib/exercise-types";
import { ExerciseStepPlayer } from "@/components/ExerciseStepPlayer";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "@/lib/i18n";

/**
 * Self-contained guided player rendered inline in the chat feed for timed or
 * passive exercises (grounding, breathing) so the companion doesn't have to
 * narrate them step by step.
 */
export function InlineExerciseWidget({
  slug,
  threadId,
}: {
  slug: string;
  threadId: string | null;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const lookup = useServerFn(getExerciseBySlug);
  const finish = useServerFn(completeExercise);

  const { data: exercise, isPending } = useQuery({
    queryKey: ["exercise-by-slug", slug],
    queryFn: () => lookup({ data: { slug } }),
  });

  const save = useMutation({
    mutationFn: (payload: {
      moodBefore: number | null;
      moodAfter: number | null;
      answers: Record<string, string>;
    }) =>
      finish({
        data: {
          exercise_id: exercise?.id as string,
          mood_before: payload.moodBefore,
          mood_after: payload.moodAfter,
          response_data: payload.answers,
          log_mood_after: true,
          thread_id: threadId,
        },
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["chat-thread", threadId] }),
        queryClient.invalidateQueries({ queryKey: ["exercises"] }),
      ]);
    },
    onError: () => toast.error(t("exercisePlayer.saveFailed")),
  });

  if (isPending) return <Skeleton className="h-40 w-full rounded-2xl" />;
  if (!exercise) return null;

  if (save.isSuccess) {
    return (
      <div className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
        {t("exercisePlayer.done", { title: exercise.title })}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs uppercase tracking-wide text-primary">{exercise.title}</p>
      <ExerciseStepPlayer
        compact
        steps={parseSteps(exercise.steps)}
        saving={save.isPending}
        onComplete={(moodBefore, moodAfter, answers) =>
          save.mutate({ moodBefore, moodAfter, answers })
        }
      />
    </div>
  );
}
