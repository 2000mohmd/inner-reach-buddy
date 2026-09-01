import { Link } from "@tanstack/react-router";
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
import type { CrisisResponse } from "@/lib/crisis";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "@/lib/i18n";

/**
 * PHQ-9 / GAD-7 check-ins, history and the item-9 crisis view.
 * Shared by /check-ins and the "Check-ins" tab of /insights.
 */
export function CheckInsSection({ showHeader = true }: { showHeader?: boolean }) {
  // NOTE: PHQ-9 / GAD-7 item text, choice labels and clinical framing come from
  // @/lib/screeners and are intentionally NOT machine-translated — a diagnostic
  // instrument must use its officially validated translation. Only the UI chrome
  // around them is localized here.
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const fetchState = useServerFn(getScreenerState);
  const submit = useServerFn(submitScreener);

  const { data, isPending } = useQuery({
    queryKey: ["screeners"],
    queryFn: () => fetchState(),
  });

  const [activeType, setActiveType] = useState<ScreenerType | null>(null);
  const [answers, setAnswers] = useState<(number | null)[]>([]);
  const [crisis, setCrisis] = useState<CrisisResponse | null>(null);

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
      toast.success(
        t("checkIns.savedScore", { score: result.total_score, severity: result.severity }),
      );
    },
    onError: () => toast.error(t("checkIns.saveFailed")),
  });

  if (crisis) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="rounded-3xl border border-crisis/40 bg-crisis-surface p-6 text-crisis">
          <h2 className="text-2xl">{t("checkIns.crisisHeading")}</h2>
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
            <Link to="/crisis">{t("checkIns.seeAllCrisis")}</Link>
          </Button>
          <Button variant="ghost" className="rounded-full" onClick={() => setCrisis(null)}>
            {t("checkIns.backToCheckIns")}
          </Button>
        </div>
      </div>
    );
  }

  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-64 w-full rounded-3xl" />
      </div>
    );
  }

  if (activeType) {
    const screener = SCREENERS[activeType];
    const complete = answers.length === screener.items.length && answers.every((v) => v !== null);
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <header>
          <h2 className="text-2xl sm:text-3xl">{screener.label}</h2>
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
            {save.isPending ? t("common.saving") : t("checkIns.saveCheckIn")}
          </Button>
          <Button
            variant="ghost"
            className="rounded-full"
            onClick={() => {
              setActiveType(null);
              setAnswers([]);
            }}
          >
            {t("common.cancel")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {showHeader && (
        <header>
          <h1 className="text-3xl sm:text-4xl">{t("checkIns.title")}</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            {t("checkIns.subtitle")} {SCREENER_FRAMING}
          </p>
        </header>
      )}

      <section className="grid gap-4 sm:grid-cols-2">
        {(data?.screeners ?? []).map((entry) => (
          <div key={entry.type} className="surface-soft space-y-4 p-6">
            <div>
              <h2 className="text-lg">{entry.label}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {entry.latest
                  ? t("checkIns.lastTaken", {
                      date: new Date(entry.latest.taken_at).toLocaleDateString(),
                      score: entry.latest.total_score,
                      max: maxScore(entry.type),
                      severity: entry.latest.severity,
                    })
                  : t("checkIns.notTakenYet")}
              </p>
              {entry.dueAt && !entry.due && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("checkIns.nextSuggested", {
                    date: new Date(entry.dueAt).toLocaleDateString(),
                  })}
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
              {entry.due ? t("checkIns.takeNow") : t("checkIns.takeAgain")}
            </Button>
          </div>
        ))}
      </section>
    </div>
  );
}
