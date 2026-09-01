import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ClipboardList, Sparkles, Wind } from "lucide-react";
import { getMyProfile } from "@/lib/onboarding.functions";
import { logMood } from "@/lib/mood.functions";
import { NudgeFeed } from "@/components/NudgeFeed";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "@/lib/i18n";

const MOOD_SCORES = [1, 2, 3, 4, 5] as const;

function greetingKey() {
  const hour = new Date().getHours();
  if (hour < 12) return "mood.goodMorning";
  if (hour < 18) return "mood.goodAfternoon";
  return "mood.goodEvening";
}

/**
 * Mood check-in, nudges and recent trend. Shared by /dashboard and the
 * "Mood & Trends" tab of /insights.
 */
export function MoodSection({ showGreeting = true }: { showGreeting?: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fetchProfile = useServerFn(getMyProfile);
  const saveMood = useServerFn(logMood);

  const { data, isPending } = useQuery({
    queryKey: ["my-profile"],
    queryFn: () => fetchProfile(),
  });

  const [score, setScore] = useState<number | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (data && !data.profile?.onboarding_completed) {
      navigate({ to: "/onboarding", replace: true });
    }
  }, [data, navigate]);

  const mutation = useMutation({
    mutationFn: () => saveMood({ data: { score: score ?? 3, note, tags: [] } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["my-profile"] });
      setScore(null);
      setNote("");
      toast.success(t("mood.saved"));
    },
    onError: () => toast.error(t("mood.saveFailed")),
  });

  const moods = data?.recentMoods ?? [];
  const average =
    moods.length > 0
      ? (moods.reduce((total, entry) => total + entry.score, 0) / moods.length).toFixed(1)
      : null;

  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-48 w-full rounded-3xl" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {showGreeting && (
        <header>
          <h1 className="text-3xl sm:text-4xl">
            {data?.profile?.preferred_name
              ? t("mood.greetingNamed", {
                  greeting: t(greetingKey()),
                  name: data.profile.preferred_name,
                })
              : t(greetingKey())}
          </h1>
          <p className="mt-2 text-muted-foreground">{t("mood.subtitle")}</p>
        </header>
      )}

      <NudgeFeed />

      <section className="surface-soft p-6 sm:p-8">
        <h2 className="text-xl">{t("mood.howFeeling")}</h2>
        <div className="mt-5 grid grid-cols-5 gap-2">
          {MOOD_SCORES.map((sc) => (
            <button
              key={sc}
              type="button"
              onClick={() => setScore(sc)}
              className={`rounded-2xl border px-1 py-4 text-center text-xs sm:text-sm ${
                score === sc
                  ? "border-primary bg-secondary font-semibold"
                  : "border-border bg-card hover:bg-muted"
              }`}
            >
              {t(`onboarding.moods.${sc}`)}
            </button>
          ))}
        </div>
        {score !== null && (
          <div className="mt-5 space-y-4">
            <Textarea
              rows={3}
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={t("mood.notePlaceholder")}
            />
            <Button
              className="rounded-full px-6"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? t("common.saving") : t("mood.saveCheckIn")}
            </Button>
          </div>
        )}
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div className="surface-soft p-6">
          <h2 className="text-lg">{t("mood.lastN", { count: moods.length || 0 })}</h2>
          {moods.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">{t("mood.nothingLogged")}</p>
          ) : (
            <>
              <div className="mt-5 flex h-24 items-end gap-2">
                {[...moods].reverse().map((entry) => (
                  <div key={entry.id} className="flex flex-1 flex-col items-center gap-2">
                    <div
                      className="w-full rounded-t-md bg-primary/70"
                      style={{ height: `${(entry.score / 5) * 100}%` }}
                      aria-hidden
                    />
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(entry.logged_at).toLocaleDateString(undefined, {
                        month: "numeric",
                        day: "numeric",
                      })}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-sm text-muted-foreground">
                {t("mood.averageLine", { avg: average ?? "—" })}
              </p>
            </>
          )}
        </div>

        <div className="surface-soft p-6">
          <h2 className="text-lg">{t("mood.whereNext")}</h2>
          <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
            <li className="flex items-start gap-3">
              <Wind className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <Link to="/exercises" className="underline underline-offset-4">
                {t("mood.guidedExercises")}
              </Link>{" "}
              {t("mood.guidedExercisesDesc")}
            </li>
            <li className="flex items-start gap-3">
              <ClipboardList className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <Link to="/check-ins" className="underline underline-offset-4">
                {t("mood.periodicCheckIns")}
              </Link>{" "}
              {t("mood.periodicCheckInsDesc")}
            </li>
            <li className="flex items-start gap-3">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <Link to="/care" className="underline underline-offset-4">
                {t("mood.talkToPerson")}
              </Link>{" "}
              {t("mood.talkToPersonDesc")}
            </li>
          </ul>
          <Link
            to="/settings"
            className="mt-5 inline-block text-sm font-semibold text-primary underline underline-offset-4"
          >
            {t("mood.reviewProfile")}
          </Link>
        </div>
      </section>
    </div>
  );
}
