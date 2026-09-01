import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { getAdminOverview } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({
    meta: [
      { title: "Admin overview — Kalm" },
      {
        name: "description",
        content:
          "Aggregate Kalm platform metrics: signups, activity, message volume, mood trend, and crisis events by severity.",
      },
      { property: "og:title", content: "Admin overview — Kalm" },
      {
        property: "og:description",
        content: "Aggregate, non-identifying platform health and safety metrics for Kalm.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminOverviewPage,
});

function shortDay(day: string) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-2xl leading-none">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function AdminOverviewPage() {
  const fetchOverview = useServerFn(getAdminOverview);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-overview"],
    queryFn: () => fetchOverview(),
    retry: false,
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  const crisisDays = data.crisis.byDay.map((row) => ({ ...row, label: shortDay(row.day) }));
  const messageDays = data.messages.byDay.map((row) => ({ ...row, label: shortDay(row.day) }));
  const moodDays = data.mood.byDay.map((row) => ({ ...row, label: shortDay(row.day) }));

  return (
    <div className="space-y-6">
      {/* Safety first: crisis signal is the headline of this page. */}
      <section className="rounded-2xl border border-crisis/30 bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-display text-xl">
              <AlertTriangle className="size-5 text-crisis" aria-hidden />
              Crisis events (30 days)
            </h2>
            <p className="text-sm text-muted-foreground">
              {data.crisis.last7} in the last 7 days · {data.crisis.unreviewed} awaiting review
            </p>
          </div>
          <Link
            to="/admin/crisis"
            className="rounded-xl bg-secondary px-3 py-1.5 text-sm text-secondary-foreground"
          >
            Open review queue
          </Link>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {data.crisis.bySeverity.map((row) => (
            <span
              key={row.severity}
              className="rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium"
            >
              {row.severity}: {row.count}
            </span>
          ))}
        </div>

        <div className="mt-4 h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={crisisDays}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="label" fontSize={11} interval={4} tickLine={false} />
              <YAxis allowDecimals={false} fontSize={11} tickLine={false} width={24} />
              <Tooltip />
              <Bar dataKey="critical" stackId="a" fill="hsl(var(--crisis))" />
              <Bar dataKey="high" stackId="a" fill="hsl(var(--primary))" />
              <Bar dataKey="moderate" stackId="a" fill="hsl(var(--muted-foreground))" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Total users"
          value={data.users.total}
          sub={`${data.users.new30} joined in 30d`}
        />
        <Stat label="New (7 days)" value={data.users.new7} />
        <Stat label="Active (7 days)" value={data.users.active7} sub="any logged activity" />
        <Stat
          label="Messages"
          value={data.messages.last7}
          sub={`${data.messages.last30} in 30 days`}
        />
        <Stat
          label="Exercise completions"
          value={data.exercises.last7}
          sub={`${data.exercises.last30} in 30 days`}
        />
        <Stat
          label="Screeners completed"
          value={data.screeners.last7}
          sub={`${data.screeners.last30} in 30 days`}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-border bg-card p-5">
          <h2 className="font-display text-lg">Message volume</h2>
          <p className="text-sm text-muted-foreground">Chat messages per day, last 30 days.</p>
          <div className="mt-4 h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={messageDays}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" fontSize={11} interval={4} tickLine={false} />
                <YAxis allowDecimals={false} fontSize={11} tickLine={false} width={28} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="count"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <h2 className="font-display text-lg">Average mood (all users)</h2>
          <p className="text-sm text-muted-foreground">
            Anonymised daily average across everyone who checked in.
          </p>
          <div className="mt-4 h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={moodDays}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                <XAxis dataKey="label" fontSize={11} interval={4} tickLine={false} />
                <YAxis domain={[1, 5]} fontSize={11} tickLine={false} width={24} />
                <Tooltip />
                <Line
                  type="monotone"
                  dataKey="average"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  connectNulls
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>
    </div>
  );
}
