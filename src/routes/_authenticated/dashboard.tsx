import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { MessageCircle, Sparkles, Wind } from "lucide-react";
import { getMyProfile } from "@/lib/onboarding.functions";
import { logMood } from "@/lib/mood.functions";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Your Kalm home" },
      {
        name: "description",
        content: "Daily check-ins, your recent mood trend and what's coming next in Kalm.",
      },
      { property: "og:title", content: "Your Kalm home" },
      {
        property: "og:description",
        content: "Daily check-ins, your recent mood trend and what's coming next in Kalm.",
      },
    ],
  }),
  component: DashboardPage,
});

const MOODS = [
  { score: 1, label: "Really low" },
  { score: 2, label: "Low" },
  { score: 3, label: "Okay" },
  { score: 4, label: "Good" },
  { score: 5, label: "Great" },
];

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function DashboardPage() {
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
      toast.success("Check-in saved. Thanks for showing up today.");
    },
    onError: () => toast.error("We couldn't save that check-in. Please try again."),
  });

  const moods = data?.recentMoods ?? [];
  const average =
    moods.length > 0
      ? (moods.reduce((total, entry) => total + entry.score, 0) / moods.length).toFixed(1)
      : null;

  return (
    <AppShell>
      {isPending ? (
        <div className="space-y-4">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-48 w-full rounded-3xl" />
        </div>
      ) : (
        <div className="space-y-8">
          <header>
            <h1 className="text-3xl sm:text-4xl">
              {greeting()}
              {data?.profile?.preferred_name ? `, ${data.profile.preferred_name}` : ""}
            </h1>
            <p className="mt-2 text-muted-foreground">
              Take a breath. This space moves at your pace.
            </p>
          </header>

          <section className="surface-soft p-6 sm:p-8">
            <h2 className="text-xl">How are you feeling right now?</h2>
            <div className="mt-5 grid grid-cols-5 gap-2">
              {MOODS.map((option) => (
                <button
                  key={option.score}
                  type="button"
                  onClick={() => setScore(option.score)}
                  className={`rounded-2xl border px-1 py-4 text-center text-xs sm:text-sm ${
                    score === option.score
                      ? "border-primary bg-secondary font-semibold"
                      : "border-border bg-card hover:bg-muted"
                  }`}
                >
                  {option.label}
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
                  placeholder="Anything you want to add? (optional)"
                />
                <Button
                  className="rounded-full px-6"
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate()}
                >
                  {mutation.isPending ? "Saving…" : "Save check-in"}
                </Button>
              </div>
            )}
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <div className="surface-soft p-6">
              <h2 className="text-lg">Your last {moods.length || 0} check-ins</h2>
              {moods.length === 0 ? (
                <p className="mt-2 text-sm text-muted-foreground">
                  Nothing logged yet. Your first check-in shows up here.
                </p>
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
                    Average mood {average} of 5. Patterns matter more than any single day.
                  </p>
                </>
              )}
            </div>

            <div className="surface-soft p-6">
              <h2 className="text-lg">Coming next to Kalm</h2>
              <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
                <li className="flex items-start gap-3">
                  <MessageCircle className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  An AI companion that already knows your introduction
                </li>
                <li className="flex items-start gap-3">
                  <Wind className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  Guided breathing, grounding and sleep exercises
                </li>
                <li className="flex items-start gap-3">
                  <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  Live voice and avatar sessions
                </li>
              </ul>
              <Link
                to="/settings"
                className="mt-5 inline-block text-sm font-semibold text-primary underline underline-offset-4"
              >
                Review your profile and data
              </Link>
            </div>
          </section>
        </div>
      )}
    </AppShell>
  );
}
