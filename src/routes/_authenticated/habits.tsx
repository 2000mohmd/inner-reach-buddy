import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { HabitsSection } from "@/components/insights/HabitsSection";

export const Route = createFileRoute("/_authenticated/habits")({
  head: () => ({
    meta: [
      { title: "Habits & mood patterns — Kalm" },
      {
        name: "description",
        content:
          "Track the small daily habits that hold you up, and see gently how they line up with your mood.",
      },
      { property: "og:title", content: "Habits & mood patterns — Kalm" },
      {
        property: "og:description",
        content:
          "Track the small daily habits that hold you up, and see gently how they line up with your mood.",
      },
    ],
  }),
  component: HabitsPage,
});

function HabitsPage() {
  return (
    <AppShell>
      <HabitsSection />
    </AppShell>
  );
}
