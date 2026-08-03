import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { MoodSection } from "@/components/insights/MoodSection";

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

function DashboardPage() {
  return (
    <AppShell>
      <MoodSection />
    </AppShell>
  );
}
