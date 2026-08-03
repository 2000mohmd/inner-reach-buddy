import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { MoodSection } from "@/components/insights/MoodSection";
import { HabitsSection } from "@/components/insights/HabitsSection";
import { CheckInsSection } from "@/components/insights/CheckInsSection";

export const Route = createFileRoute("/_authenticated/insights")({
  head: () => ({
    meta: [
      { title: "Your insights — Kalm" },
      {
        name: "description",
        content:
          "Mood trends, habit patterns and periodic PHQ-9 / GAD-7 check-ins, together in one calm view.",
      },
      { property: "og:title", content: "Your insights — Kalm" },
      {
        property: "og:description",
        content: "Mood trends, habits and periodic check-ins in one place.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: InsightsPage,
});

const TABS = [
  { id: "mood", label: "Mood & Trends" },
  { id: "habits", label: "Habits" },
  { id: "check-ins", label: "Check-ins" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function InsightsPage() {
  const [tab, setTab] = useState<TabId>("mood");

  return (
    <AppShell>
      <div className="space-y-8">
        <header>
          <h1 className="text-3xl sm:text-4xl">Insights</h1>
          <p className="mt-2 text-muted-foreground">
            How you've been, what you've been keeping up, and how your check-ins are moving.
          </p>
        </header>

        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Insights sections">
          {TABS.map((entry) => (
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

        <div>
          {tab === "mood" && <MoodSection showGreeting={false} />}
          {tab === "habits" && <HabitsSection showHeader={false} />}
          {tab === "check-ins" && <CheckInsSection showHeader={false} />}
        </div>
      </div>
    </AppShell>
  );
}
