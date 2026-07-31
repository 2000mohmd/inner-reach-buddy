import { createFileRoute, Link } from "@tanstack/react-router";
import { PhoneCall, MessageSquare, Globe, ArrowLeft } from "lucide-react";
import { SafetyFooter } from "@/components/SafetyFooter";

export const Route = createFileRoute("/crisis")({
  head: () => ({
    meta: [
      { title: "Crisis resources — Kalm" },
      {
        name: "description",
        content:
          "Immediate crisis support lines and text services. Always free and never gated in Kalm.",
      },
      { property: "og:title", content: "Crisis resources — Kalm" },
      {
        property: "og:description",
        content: "Immediate crisis support lines and text services, always available in Kalm.",
      },
    ],
  }),
  component: CrisisPage,
});

const RESOURCES = [
  {
    icon: PhoneCall,
    title: "988 Suicide & Crisis Lifeline (US)",
    detail: "Call or text 988 — 24/7, free and confidential.",
    href: "tel:988",
    action: "Call 988",
  },
  {
    icon: MessageSquare,
    title: "Crisis Text Line (US, UK, CA, IE)",
    detail: "Text HOME to 741741 to reach a trained crisis counselor.",
    href: "sms:741741?&body=HOME",
    action: "Text HOME",
  },
  {
    icon: Globe,
    title: "Find a line in your country",
    detail: "Findahelpline.com lists verified helplines worldwide.",
    href: "https://findahelpline.com",
    action: "Open directory",
  },
];

function CrisisPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-14">
        <Link
          to="/"
          className="mb-8 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back
        </Link>

        <h1 className="text-4xl">You don't have to handle this alone</h1>
        <p className="mt-4 text-lg text-muted-foreground">
          If you're thinking about harming yourself or someone else, or you're in immediate danger,
          please reach a real person now. These services are free, confidential, and staffed by
          trained humans.
        </p>

        <div className="mt-10 space-y-4">
          {RESOURCES.map(({ icon: Icon, title, detail, href, action }) => (
            <a
              key={title}
              href={href}
              target={href.startsWith("http") ? "_blank" : undefined}
              rel="noreferrer"
              className="surface-soft flex items-start gap-4 p-6 hover:border-primary"
            >
              <Icon className="mt-1 size-6 shrink-0 text-primary" aria-hidden />
              <span className="flex-1">
                <span className="block text-lg font-semibold">{title}</span>
                <span className="mt-1 block text-muted-foreground">{detail}</span>
                <span className="mt-3 block text-sm font-semibold text-primary underline underline-offset-4">
                  {action}
                </span>
              </span>
            </a>
          ))}
        </div>

        <div className="mt-10 rounded-2xl border border-crisis/40 bg-crisis-surface p-6 text-crisis">
          <p className="font-semibold">If there is immediate danger to life</p>
          <p className="mt-1">
            Call your local emergency number (911 in the US, 999 in the UK, 112 in the EU) or go to
            the nearest emergency department.
          </p>
        </div>
      </main>
      <SafetyFooter />
    </div>
  );
}
