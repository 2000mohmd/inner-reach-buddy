import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { AlertTriangle, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { listAdminUsers } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/users/")({
  head: () => ({
    meta: [
      { title: "Users — Kalm admin" },
      {
        name: "description",
        content:
          "Admin user directory: account type, signup date, last activity, engagement state, and crisis history counts.",
      },
      { property: "og:title", content: "Users — Kalm admin" },
      {
        property: "og:description",
        content: "Search and filter Kalm members by account type, engagement, and crisis history.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminUsersPage,
});

const ENGAGEMENT_LABELS: Record<string, string> = {
  active_week: "Active this week",
  quiet_2w: "Quiet 1–4 weeks",
  quiet_month: "Quiet 4+ weeks",
  never: "No activity yet",
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function AdminUsersPage() {
  const fetchUsers = useServerFn(listAdminUsers);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => fetchUsers(),
    retry: false,
  });

  const [search, setSearch] = useState("");
  const [accountType, setAccountType] = useState("");
  const [engagement, setEngagement] = useState("");
  const [onlyCrisis, setOnlyCrisis] = useState(false);

  const users = data?.users ?? [];
  const filtered = useMemo(
    () =>
      users.filter((user) => {
        if (search && !(user.preferred_name ?? "").toLowerCase().includes(search.toLowerCase())) {
          return false;
        }
        if (accountType && user.account_type !== accountType) return false;
        if (engagement && user.engagement !== engagement) return false;
        if (onlyCrisis && user.crisis_count === 0) return false;
        return true;
      }),
    [users, search, accountType, engagement, onlyCrisis],
  );

  const selectClass =
    "rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground";

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-2xl">Users</h2>
        <p className="text-sm text-muted-foreground">
          {users.length} accounts. Opening a profile is recorded in the audit log.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name"
            aria-label="Search users by name"
            className="pl-9"
          />
        </div>
        <select
          aria-label="Filter by account type"
          className={selectClass}
          value={accountType}
          onChange={(event) => setAccountType(event.target.value)}
        >
          <option value="">All account types</option>
          <option value="general">general</option>
          <option value="condition">condition</option>
          <option value="teen">teen</option>
          <option value="org_member">org_member</option>
        </select>
        <select
          aria-label="Filter by engagement"
          className={selectClass}
          value={engagement}
          onChange={(event) => setEngagement(event.target.value)}
        >
          <option value="">Any engagement</option>
          {Object.entries(ENGAGEMENT_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={onlyCrisis}
            onChange={(event) => setOnlyCrisis(event.target.checked)}
          />
          Crisis history only
        </label>
      </div>

      {isLoading ? (
        <Skeleton className="h-48 w-full rounded-2xl" />
      ) : !filtered.length ? (
        <p className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
          No users match these filters.
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {filtered.map((user) => (
            <li key={user.id}>
              <Link
                to="/admin/users/$userId"
                params={{ userId: user.id }}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm hover:bg-muted/60"
              >
                <span className="font-medium">
                  {user.preferred_name ?? `Member ${user.id.slice(0, 6)}`}
                </span>
                <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                  {user.account_type}
                </span>
                {user.crisis_count > 0 && (
                  <span className="flex items-center gap-1 rounded-full border border-crisis/40 bg-crisis-surface px-2 py-0.5 text-[11px] font-semibold text-crisis">
                    <AlertTriangle className="size-3" aria-hidden />
                    {user.crisis_count}
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  joined {formatDate(user.created_at)} · last active{" "}
                  {formatDate(user.last_active_at)}
                </span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {ENGAGEMENT_LABELS[user.engagement]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
