import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { getScreenerState, submitScreener } from "@/lib/screeners.functions";
import {
  SCREENERS,
  SCREENER_CHOICES,
  SCREENER_FRAMING,
  maxScore,
  type ScreenerType,
} from "@/lib/screeners";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/check-ins")({
  head: () => ({
    meta: [
      { title: "Periodic check-ins — Kalm" },
      {
        name: "description",
        content:
          "Take the PHQ-9 and GAD-7 every couple of weeks and see how your scores move over time. Not a diagnosis.",
      },
      { property: "og:title", content: "Periodic check-ins — Kalm" },
      {
        property: "og:description",
        content: "PHQ-9 and GAD-7 check-ins with a score history over time.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CheckInsPage,
});

function CheckInsPage() {
  const queryClient = useQueryClient();
  const fetchState = useServerFn(getScreenerState);
  const submit = useServerFn(submitScreener);

  const { data, isPending } = useQuery({
    queryKey: ["screeners"],
    queryFn: () => fetchState(),
  });

  const [activeType, setActiveType] = useState<ScreenerType | null>(null);
  const [answers, setAnswers] = useState<(number | null)[]>([]);

  const save = useMutation({
    mutationFn: () =>
      submit({
        data: {
          screener_type: activeType as ScreenerType,
          responses: answers.map((value) => value ?? 0),
        },
      }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["screeners"] });
      await queryClient.invalidateQueries({ queryKey: ["nudges"] });
      setActiveType(null);
      setAnswers([]);
      if (result.crisisTriggered && result.crisis) {
        setCrisis(result.crisis);
        return;
      }
      toast.success(`Saved — ${result.total_score} (${result.severity} range).`);
    },
    onError: () => toast.error("We couldn't save that. Please try again."),
  });

  if (crisis) {
    return (
      <AppShell>
        <div className="mx-auto max-w-2xl space-y-6">
          <div className="rounded-3xl border border-crisis/40 bg-crisis-surface p-6 text-crisis">
            <h1 className="text-2xl">You don't have to sit with this alone</h1>
            <p className="mt-3">{crisis.message}</p>
          </div>
          <ul className="space-y-3">
            {crisis.resources.map((resource) => (
              <li key={resource.name} className="surface-soft p-5">
                <p className="font-semibold">{resource.name}</p>
                <p className="mt-1 text-sm">{resource.contact}</p>
                <p className="mt-1 text-sm text-muted-foreground">{resource.detail}</p>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">{crisis.disclaimer}</p>
          <div className="flex flex-wrap gap-3">
            <Button asChild className="rounded-full px-6">
              <Link to="/crisis">See all crisis resources</Link>
            </Button>
            <Button variant="ghost" className="rounded-full" onClick={() => setCrisis(null)}>
              Back to check-ins
            </Button>
          </div>
        </div>
      </AppShell>
    );
  }


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

  if (activeType) {
    const screener = SCREENERS[activeType];
    const complete = answers.length === screener.items.length && answers.every((v) => v !== null);
    return (
      <AppShell>
        <div className="mx-auto max-w-2xl space-y-6">
          <header>
            <h1 className="text-2xl sm:text-3xl">{screener.label}</h1>
            <p className="mt-2 text-muted-foreground">{screener.prompt}</p>
            <p className="mt-2 text-sm text-muted-foreground">{SCREENER_FRAMING}</p>
          </header>

          <ol className="space-y-4">
            {screener.items.map((item, index) => (
              <li key={item} className="surface-soft p-5">
                <p className="text-sm">
                  {index + 1}. {item}
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-4">
                  {SCREENER_CHOICES.map((choice) => (
                    <button
                      key={choice.value}
                      type="button"
                      onClick={() =>
                        setAnswers((prev) => {
                          const next = [...prev];
                          while (next.length < screener.items.length) next.push(null);
                          next[index] = choice.value;
                          return next;
                        })
                      }
                      className={`rounded-2xl border px-2 py-2 text-xs ${
                        answers[index] === choice.value
                          ? "border-primary bg-secondary font-semibold"
                          : "border-border bg-card hover:bg-muted"
                      }`}
                    >
                      {choice.label}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ol>

          <div className="flex gap-3">
            <Button
              className="rounded-full px-6"
              disabled={!complete || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? "Saving…" : "Save check-in"}
            </Button>
            <Button
              variant="ghost"
              className="rounded-full"
              onClick={() => {
                setActiveType(null);
                setAnswers([]);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-8">
        <header>
          <h1 className="text-3xl sm:text-4xl">Periodic check-ins</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            Two short, well-established questionnaires, suggested every two weeks. {SCREENER_FRAMING}
          </p>
        </header>

        <section className="grid gap-4 sm:grid-cols-2">
          {(data?.screeners ?? []).map((entry) => (
            <div key={entry.type} className="surface-soft space-y-4 p-6">
              <div>
                <h2 className="text-lg">{entry.label}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {entry.latest
                    ? `Last taken ${new Date(entry.latest.taken_at).toLocaleDateString()} — ${entry.latest.total_score} of ${maxScore(entry.type)} (${entry.latest.severity} range).`
                    : "Not taken yet."}
                </p>
                {entry.dueAt && !entry.due && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Next suggested {new Date(entry.dueAt).toLocaleDateString()}.
                  </p>
                )}
              </div>

              {entry.history.length > 1 && (
                <div className="flex h-20 items-end gap-1.5">
                  {entry.history.slice(-12).map((row) => (
                    <div key={row.id} className="flex flex-1 flex-col items-center gap-1">
                      <div
                        className="w-full rounded-t-md bg-primary/70"
                        style={{
                          height: `${Math.max(6, (row.total_score / maxScore(entry.type)) * 100)}%`,
                        }}
                        aria-hidden
                      />
                      <span className="text-[10px] text-muted-foreground">{row.total_score}</span>
                    </div>
                  ))}
                </div>
              )}

              <Button
                variant={entry.due ? "default" : "outline"}
                className="rounded-full"
                onClick={() => {
                  setActiveType(entry.type);
                  setAnswers(new Array(SCREENERS[entry.type].items.length).fill(null));
                }}
              >
                {entry.due ? "Take it now" : "Take it again"}
              </Button>
            </div>
          ))}
        </section>
      </div>
    </AppShell>
  );
}
