import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowLeft } from "lucide-react";
import { CRISIS_SOURCE_LABELS, CrisisSeverityBadge } from "@/components/CrisisSeverityBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { getAdminUserDetail } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/users/$userId")({
  head: () => ({
    meta: [
      { title: "Member detail — Kalm admin" },
      {
        name: "description",
        content:
          "Admin view of one Kalm member: self-introduction, mood trend, activity summary, and crisis event history.",
      },
      { property: "og:title", content: "Member detail — Kalm admin" },
      {
        property: "og:description",
        content: "Self-introduction, mood trend, activity, and crisis history for one member.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminUserDetailPage,
});

function formatWhen(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm">{value || "—"}</p>
    </div>
  );
}

function AdminUserDetailPage() {
  const { userId } = Route.useParams();
  const fetchDetail = useServerFn(getAdminUserDetail);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-user-detail", userId],
    queryFn: () => fetchDetail({ data: { user_id: userId } }),
    retry: false,
  });

  if (isLoading || !data) {
    return <Skeleton className="h-64 w-full rounded-2xl" />;
  }

  const moodSeries = data.mood.map((row) => ({
    label: new Date(`${row.day}T00:00:00Z`).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
    score: row.score,
  }));

  return (
    <div className="space-y-5">
      <Link
        to="/admin/users"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        All users
      </Link>

      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="font-display text-2xl">
          {data.profile?.preferred_name ?? `Member ${userId.slice(0, 6)}`}
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Account type" value={data.profile?.account_type ?? "—"} />
          <Field label="Plan" value={data.profile?.subscription_tier ?? "—"} />
          <Field label="Joined" value={formatWhen(data.profile?.created_at ?? null)} />
          <Field label="Last active" value={formatWhen(data.activity.lastActive)} />
          <Field label="Timezone" value={data.profile?.timezone ?? "—"} />
          <Field
            label="Onboarding"
            value={data.profile?.onboarding_completed ? "Completed" : "Incomplete"}
          />
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-5">
        <h3 className="font-display text-lg">Self-introduction</h3>
        <p className="text-xs text-muted-foreground">
          What the member chose to share at onboarding. Chat transcripts are not shown here.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Intro" value={data.selfIntro?.intro_text ?? ""} />
          <Field label="Goals" value={(data.selfIntro?.goals ?? []).join(", ")} />
          <Field label="Stressors" value={(data.selfIntro?.stressors ?? []).join(", ")} />
          <Field label="Existing diagnosis" value={data.selfIntro?.existing_diagnosis ?? ""} />
          <Field
            label="Communication preference"
            value={data.selfIntro?.communication_preference ?? ""}
          />
          <Field label="Topics to avoid" value={data.selfIntro?.topics_to_avoid ?? ""} />
          <Field
            label="In professional care"
            value={data.selfIntro?.in_professional_care ? "Yes" : "No"}
          />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="font-display text-lg">Mood trend (60 days)</h3>
          {moodSeries.length ? (
            <div className="mt-3 h-52 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={moodSeries}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border))"
                    vertical={false}
                  />
                  <XAxis dataKey="label" fontSize={11} interval="preserveStartEnd" tickLine={false} />
                  <YAxis domain={[1, 5]} fontSize={11} tickLine={false} width={24} />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">No check-ins in this window.</p>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <h3 className="font-display text-lg">Activity summary</h3>
          <ul className="mt-3 space-y-1.5 text-sm">
            <li>Messages sent/received: {data.activity.messages}</li>
            <li>Exercise completions: {data.activity.exercises}</li>
            <li>
              Habits: {data.activity.habits} tracked · {data.activity.habitLogs} logs
            </li>
            <li>Screeners completed: {data.activity.screeners}</li>
          </ul>

          {data.screeners.length > 0 && (
            <>
              <h4 className="mt-4 text-xs uppercase tracking-wide text-muted-foreground">
                Recent screeners
              </h4>
              <ul className="mt-1 space-y-1 text-sm">
                {data.screeners.slice(0, 5).map((row) => (
                  <li key={`${row.screener_type}-${row.taken_at}`} className="text-muted-foreground">
                    {row.screener_type.toUpperCase()} · {row.total_score} ({row.severity}) ·{" "}
                    {formatWhen(row.taken_at)}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-5">
        <h3 className="font-display text-lg">Crisis events</h3>
        {!data.crisisEvents.length ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No crisis events have been flagged for this member.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {data.crisisEvents.map((event) => (
              <li
                key={event.id}
                className={`rounded-xl border p-3 ${
                  event.reviewed ? "border-border bg-card/60" : "border-crisis/30"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <CrisisSeverityBadge severity={event.severity} />
                  <span className="text-sm">
                    {CRISIS_SOURCE_LABELS[event.source] ?? event.source}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {formatWhen(event.created_at)}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {event.reviewed ? "Reviewed" : "Awaiting review"}
                  </span>
                </div>
                {event.matched_terms.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Matched: {event.matched_terms.join(", ")}
                  </p>
                )}
                {event.notes && <p className="mt-1 text-xs text-muted-foreground">{event.notes}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
