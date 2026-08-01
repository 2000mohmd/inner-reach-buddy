import { createFileRoute, Link } from "@tanstack/react-router";
import { Leaf, MessageCircleHeart, LineChart, Sparkles, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SafetyFooter } from "@/components/SafetyFooter";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Kalm — Calm, private AI mental wellness support" },
      {
        name: "description",
        content:
          "Kalm blends an AI companion, mood and habit tracking, and guided CBT exercises into one calm daily wellness practice.",
      },
      { property: "og:title", content: "Kalm — Calm, private AI mental wellness support" },
      {
        property: "og:description",
        content:
          "Kalm blends an AI companion, mood and habit tracking, and guided CBT exercises into one calm daily wellness practice.",
      },
    ],
  }),
  component: Index,
});

const PILLARS = [
  {
    icon: MessageCircleHeart,
    title: "A companion that remembers",
    body: "Your self-introduction, goals and recent check-ins shape every conversation from the first message.",
  },
  {
    icon: LineChart,
    title: "Gentle tracking",
    body: "Mood and habit check-ins that surface patterns — never streak guilt or shame nudges.",
  },
  {
    icon: Sparkles,
    title: "Guided practice",
    body: "Short CBT reframes, grounding and journaling flows you can finish in a few quiet minutes.",
  },
];

function Index() {
  return (
    <div className="flex min-h-screen flex-col">
      <main className="flex-1">
        <section className="breathe-gradient">
          <div className="mx-auto max-w-4xl px-6 py-24 text-center sm:py-32">
            <p className="mx-auto mb-8 inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-4 py-1.5 text-sm text-muted-foreground">
              <Leaf className="size-4 text-primary" aria-hidden />
              Kalm
            </p>
            <h1 className="text-balance text-5xl leading-[1.05] sm:text-6xl">
              A quieter place to check in with yourself.
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-pretty text-lg text-muted-foreground">
              Kalm is a wellness support companion — AI conversation, mood tracking and guided
              exercises, built around what you tell it about your life.
            </p>
            <div className="mt-10 flex justify-center">
              <Button asChild size="lg" className="rounded-full px-8">
                <Link to="/auth">Create your account</Link>
              </Button>
            </div>
            <p className="mt-6 text-sm text-muted-foreground">
              Already here?{" "}
              <Link to="/auth" className="font-semibold text-primary underline underline-offset-4">
                Sign in
              </Link>
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-6 py-20">
          <div className="grid gap-6 sm:grid-cols-3">
            {PILLARS.map(({ icon: Icon, title, body }) => (
              <article key={title} className="surface-soft p-7">
                <Icon className="size-6 text-primary" aria-hidden />
                <h2 className="mt-5 text-xl">{title}</h2>
                <p className="mt-2 text-base text-muted-foreground">{body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-6 pb-24">
          <div className="surface-soft flex flex-col gap-4 p-8 sm:flex-row sm:items-start">
            <ShieldCheck className="size-7 shrink-0 text-primary" aria-hidden />
            <div>
              <h2 className="text-xl">Support, not treatment</h2>
              <p className="mt-2 text-base text-muted-foreground">
                Kalm is a wellness support tool. It is not therapy, not a diagnosis, and not an
                emergency service. Every conversation is screened for crisis language, and crisis
                resources are always one tap away and never behind a paywall.
              </p>
              <div className="mt-4 flex flex-wrap gap-4 text-sm">
                <Link to="/crisis" className="font-semibold text-primary underline underline-offset-4">
                  Crisis resources
                </Link>
                <Link to="/legal" className="font-semibold text-primary underline underline-offset-4">
                  Privacy &amp; disclaimers
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
      <SafetyFooter />
    </div>
  );
}
