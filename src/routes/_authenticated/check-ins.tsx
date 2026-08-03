import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { CheckInsSection } from "@/components/insights/CheckInsSection";

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
  return (
    <AppShell>
      <CheckInsSection />
    </AppShell>
  );
}
