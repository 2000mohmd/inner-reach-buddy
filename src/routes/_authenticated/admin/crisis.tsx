import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { listCrisisEvents, markCrisisReviewed } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/crisis")({
  head: () => ({
    meta: [
      { title: "Crisis review — Kalm admin" },
      {
        name: "description",
        content:
          "Internal safety queue: review crisis events flagged by the regex gate, screener escalation, or the semantic backstop.",
      },
      { property: "og:title", content: "Crisis review — Kalm admin" },
      {
        property: "og:description",
        content: "Internal safety review queue for flagged crisis events.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CrisisReviewPage,
});

const SOURCE_LABELS: Record<string, string> = {
  chat: "Chat (regex gate)",
  phq9_item9: "PHQ-9 item 9",
  semantic_classifier: "Semantic backstop",
};

function formatWhen(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function CrisisReviewPage() {
  const fetchEvents = useServerFn(listCrisisEvents);
  const review = useServerFn(markCrisisReviewed);
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-crisis-events"],
    queryFn: () => fetchEvents(),
    retry: false,
  });

  const mutation = useMutation({
    mutationFn: (eventId: string) => review({ data: { event_id: eventId } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-crisis-events"] });
      queryClient.invalidateQueries({ queryKey: ["admin-crisis-unreviewed"] });
    },
  });

  const forbidden = error instanceof Error && /forbidden/i.test(error.message);

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8">
        <header className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Internal
          </p>
          <h1 className="font-display text-3xl">Crisis review</h1>
          <p className="text-sm text-muted-foreground">
            Flagged moments that a human should look at. Unreviewed first.
          </p>
        </header>

        {forbidden ? (
          <div className="rounded-2xl border border-border bg-card p-6">
            <h2 className="font-display text-xl">Not available</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              This page is for administrators only.
            </p>
            <Button asChild variant="secondary" className="mt-4">
              <Link to="/chat">Back to Kalm</Link>
            </Button>
          </div>
        ) : isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full rounded-2xl" />
            <Skeleton className="h-20 w-full rounded-2xl" />
          </div>
        ) : (
          <>
            <div
              className={`flex items-center gap-3 rounded-2xl border p-4 ${
                (data?.unreviewed ?? 0) > 0
                  ? "border-crisis/40 bg-crisis-surface text-crisis"
                  : "border-border bg-card"
              }`}
            >
              {(data?.unreviewed ?? 0) > 0 ? (
                <AlertTriangle className="size-5 shrink-0" aria-hidden />
              ) : (
                <ShieldCheck className="size-5 shrink-0 text-primary" aria-hidden />
              )}
              <div>
                <p className="font-display text-2xl leading-none">{data?.unreviewed ?? 0}</p>
                <p className="text-sm">
                  {(data?.unreviewed ?? 0) === 1 ? "event awaiting review" : "events awaiting review"}
                </p>
              </div>
            </div>

            {!data?.events.length ? (
              <p className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
                No crisis events have been logged.
              </p>
            ) : (
              <ul className="space-y-3">
                {data.events.map((event) => (
                  <li
                    key={event.id}
                    className={`rounded-2xl border p-4 ${
                      event.reviewed ? "border-border bg-card/60" : "border-crisis/30 bg-card"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <p className="text-sm font-medium">
                          {event.preferred_name ?? "Unnamed member"}
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            {formatWhen(event.created_at)}
                          </span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {SOURCE_LABELS[event.source] ?? event.source} · severity {event.severity}
                        </p>
                        {event.matched_terms.length > 0 && (
                          <p className="text-xs text-muted-foreground">
                            Signals: {event.matched_terms.join(", ")}
                          </p>
                        )}
                        {event.notes && (
                          <p className="text-sm text-foreground/80">{event.notes}</p>
                        )}
                      </div>
                      {event.reviewed ? (
                        <span className="shrink-0 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                          Reviewed
                          {event.reviewed_at ? ` · ${formatWhen(event.reviewed_at)}` : ""}
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => mutation.mutate(event.id)}
                          disabled={mutation.isPending}
                        >
                          Mark reviewed
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
