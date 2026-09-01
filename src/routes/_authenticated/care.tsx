import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listCareResources } from "@/lib/nudges.functions";
import { AppShell } from "@/components/AppShell";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/care")({
  head: () => ({
    meta: [
      { title: "More support than I can offer — Kalm" },
      {
        name: "description",
        content:
          "Therapist directories, low-cost therapy options, employer support and crisis lines — for when it's time to talk to a person.",
      },
      { property: "og:title", content: "More support than I can offer — Kalm" },
      {
        property: "og:description",
        content: "Therapist directories, low-cost therapy, employer support and crisis lines.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CarePage,
});

const GROUP_KEYS = ["directory", "low_cost", "employer_eap", "crisis"] as const;

function CarePage() {
  const { t } = useTranslation();
  const fetchResources = useServerFn(listCareResources);
  const { data, isPending } = useQuery({
    queryKey: ["care-resources"],
    queryFn: () => fetchResources(),
  });

  return (
    <AppShell>
      <div className="space-y-8">
        <header>
          <h1 className="text-3xl sm:text-4xl">{t("care.title")}</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">{t("care.subtitle")}</p>
        </header>

        {isPending ? (
          <Skeleton className="h-64 w-full rounded-3xl" />
        ) : (
          GROUP_KEYS.map((groupType) => {
            const rows = (data ?? []).filter((row) => row.resource_type === groupType);
            if (rows.length === 0) return null;
            return (
              <section key={groupType} className="surface-soft p-6">
                <h2 className="text-lg">{t(`care.groups.${groupType}`)}</h2>
                <ul className="mt-4 space-y-4 text-sm">
                  {rows.map((row) => (
                    <li key={row.id}>
                      <p className="font-medium">{row.name}</p>
                      <p className="text-muted-foreground">{row.description}</p>
                      {row.contact_or_url.startsWith("http") ? (
                        <a
                          href={row.contact_or_url}
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold text-primary underline underline-offset-4"
                        >
                          {row.contact_or_url.replace(/^https?:\/\//, "")}
                        </a>
                      ) : (
                        <p className="font-semibold text-primary">{row.contact_or_url}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </div>
    </AppShell>
  );
}
