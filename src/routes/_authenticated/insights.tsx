import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ChevronDown, Compass, Sparkles } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { MoodSection } from "@/components/insights/MoodSection";
import { HabitsSection } from "@/components/insights/HabitsSection";
import { CheckInsSection } from "@/components/insights/CheckInsSection";
import { listWeeklyDigests } from "@/lib/digests.functions";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/insights")({
  head: () => ({
    meta: [
      { title: "Your progress — Kalm" },
      {
        name: "description",
        content:
          "A weekly recap of how things have been going, one small focus for the week ahead, and the numbers behind it if you want them.",
      },
      { property: "og:title", content: "Your progress — Kalm" },
      {
        property: "og:description",
        content: "A warm weekly recap of your wellbeing, plus one small focus for the week ahead.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ProgressPage,
});

const NUMBER_TABS = [
  { id: "mood", label: "Mood & Trends" },
  { id: "habits", label: "Habits" },
  { id: "check-ins", label: "Check-ins" },
] as const;

type TabId = (typeof NUMBER_TABS)[number]["id"];

function weekLabel(weekStart: string) {
  const start = new Date(`${weekStart}T00:00:00`);
  const end = new Date(start.getTime() + 6 * 86400000);
  const fmt = (date: Date) => date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}

function ProgressPage() {
  const fetchDigests = useServerFn(listWeeklyDigests);
  const { data, isPending } = useQuery({
    queryKey: ["weekly-digests"],
    queryFn: () => fetchDigests(),
  });

  const [showNumbers, setShowNumbers] = useState(false);
  const [tab, setTab] = useState<TabId>("mood");
  const [openId, setOpenId] = useState<string | null>(null);

  const digests = data?.digests ?? [];
  const latest = digests[0];
  const past = digests.slice(1);

  return (
    <AppShell>
      <div className="space-y-10">
        <header>
          <h1 className="text-3xl sm:text-4xl">Progress</h1>
          <p className="mt-2 text-muted-foreground">
            A short recap of how your weeks have actually been going.
          </p>
        </header>

        {isPending ? (
          <Skeleton className="h-64 w-full rounded-3xl" />
        ) : latest ? (
          <section className="surface-soft p-6 sm:p-8">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Week of {weekLabel(latest.week_start)}
            </p>
            <p className="mt-4 whitespace-pre-line text-lg leading-relaxed sm:text-xl">
              {latest.narrative_text}
            </p>
            {latest.suggested_focus && (
              <div className="mt-6 flex gap-3 rounded-2xl bg-secondary/60 p-5">
                <Compass className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
                <div>
                  <p className="text-sm font-semibold">One thing for this week</p>
                  <p className="mt-1 text-sm text-secondary-foreground">
                    {latest.suggested_focus}
                  </p>
                </div>
              </div>
            )}
          </section>
        ) : (
          <section className="surface-soft p-6 sm:p-8">
            <Sparkles className="size-6 text-primary" aria-hidden />
            <h2 className="mt-3 text-xl">Your first recap is on its way</h2>
            <p className="mt-2 max-w-prose text-muted-foreground">
              Once you've had a week of checking in, ticking off habits or trying an exercise, Kalm
              will write you a short recap of how it went — in plain language, with one small focus
              for the week ahead. Nothing to set up; it'll simply be here.
            </p>
          </section>
        )}

        {past.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-xl">Earlier weeks</h2>
            <div className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">
              {past.map((digest) => {
                const open = openId === digest.id;
                return (
                  <div key={digest.id} className="surface-soft overflow-hidden">
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => setOpenId(open ? null : digest.id)}
                      className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-muted/40"
                    >
                      <span className="text-sm font-medium">
                        Week of {weekLabel(digest.week_start)}
                      </span>
                      <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                        {digest.suggested_focus ? "Focus set" : ""}
                        <ChevronDown
                          className={`size-4 transition-transform ${open ? "rotate-180" : ""}`}
                          aria-hidden
                        />
                      </span>
                    </button>
                    {open && (
                      <div className="border-t border-border/60 px-5 py-4 text-sm leading-relaxed">
                        <p className="whitespace-pre-line">{digest.narrative_text}</p>
                        {digest.suggested_focus && (
                          <p className="mt-3 text-muted-foreground">
                            Focus that week: {digest.suggested_focus}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <section className="space-y-6 border-t border-border/60 pt-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl">See the numbers</h2>
              <p className="text-sm text-muted-foreground">
                Mood trends, habit grid and check-in scores, if you'd like the detail.
              </p>
            </div>
            <Button
              variant="outline"
              className="rounded-full px-5"
              onClick={() => setShowNumbers((value) => !value)}
              aria-expanded={showNumbers}
            >
              {showNumbers ? "Hide" : "Show"}
            </Button>
          </div>

          {showNumbers && (
            <div className="space-y-6">
              <div className="flex flex-wrap gap-2" role="tablist" aria-label="Data sections">
                {NUMBER_TABS.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === entry.id}
                    onClick={() => setTab(entry.id)}
                    className={`rounded-full px-4 py-2 text-sm ${
                      tab === entry.id
                        ? "bg-secondary font-semibold text-secondary-foreground"
                        : "border border-border bg-card text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
              {tab === "mood" && <MoodSection showGreeting={false} />}
              {tab === "habits" && <HabitsSection showHeader={false} />}
              {tab === "check-ins" && <CheckInsSection showHeader={false} />}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
