import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { MessageCircleHeart, LineChart, Sparkles, ShieldCheck } from "lucide-react";
import { KalmLogo } from "@/components/KalmLogo";
import { Button } from "@/components/ui/button";
import { SafetyFooter } from "@/components/SafetyFooter";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { supabase } from "@/integrations/supabase/client";
import { useTranslation } from "@/lib/i18n";

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
  { icon: MessageCircleHeart, key: "companion" },
  { icon: LineChart, key: "tracking" },
  { icon: Sparkles, key: "practice" },
] as const;

function Index() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // Signed-in users who land here (e.g. the "Back" link on /crisis and /legal)
  // are sent to the app, mirroring /auth. Keeps "Back to home" correct for both.
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/chat", replace: true });
    });
  }, [navigate]);

  return (
    <div className="flex min-h-screen flex-col">
      <div className="flex justify-end px-6 pt-4">
        <LanguageSwitcher className="w-auto" />
      </div>
      <main className="flex-1">
        <section className="breathe-gradient">
          <div className="mx-auto max-w-4xl px-6 pb-24 pt-10 text-center sm:pb-32">
            <p className="mx-auto mb-8 inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-4 py-1.5 text-sm text-muted-foreground">
              <KalmLogo className="size-4 text-primary" aria-hidden />
              Kalm
            </p>
            <h1 className="text-balance text-5xl leading-[1.05] sm:text-6xl">
              {t("landing.headline")}
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-pretty text-lg text-muted-foreground">
              {t("landing.subhead")}
            </p>
            <div className="mt-10 flex justify-center">
              <Button asChild size="lg" className="rounded-full px-8">
                <Link to="/auth">{t("landing.createAccount")}</Link>
              </Button>
            </div>
            <p className="mt-6 text-sm text-muted-foreground">
              {t("landing.alreadyHere")}{" "}
              <Link to="/auth" className="font-semibold text-primary underline underline-offset-4">
                {t("auth.signIn")}
              </Link>
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-6 py-20">
          <div className="grid gap-6 sm:grid-cols-3">
            {PILLARS.map(({ icon: Icon, key }) => (
              <article key={key} className="surface-soft p-7">
                <Icon className="size-6 text-primary" aria-hidden />
                <h2 className="mt-5 text-xl">{t(`landing.pillars.${key}.title`)}</h2>
                <p className="mt-2 text-base text-muted-foreground">
                  {t(`landing.pillars.${key}.body`)}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-6 pb-24">
          <div className="surface-soft flex flex-col gap-4 p-8 sm:flex-row sm:items-start">
            <ShieldCheck className="size-7 shrink-0 text-primary" aria-hidden />
            <div>
              <h2 className="text-xl">{t("landing.supportTitle")}</h2>
              <p className="mt-2 text-base text-muted-foreground">{t("landing.supportBody")}</p>
              <div className="mt-4 flex flex-wrap gap-4 text-sm">
                <Link
                  to="/crisis"
                  className="font-semibold text-primary underline underline-offset-4"
                >
                  {t("landing.crisisResources")}
                </Link>
                <Link
                  to="/legal"
                  className="font-semibold text-primary underline underline-offset-4"
                >
                  {t("landing.privacyDisclaimers")}
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
