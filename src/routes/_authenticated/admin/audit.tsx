import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { listAdminAuditLog } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/audit")({
  head: () => ({
    meta: [
      { title: "Admin audit log — Kalm" },
      {
        name: "description",
        content:
          "Record of privileged admin actions in Kalm: user detail views, crisis reviews, support replies, and role grants.",
      },
      { property: "og:title", content: "Admin audit log — Kalm" },
      {
        property: "og:description",
        content: "Who did what, and when, across the Kalm admin area.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminAuditPage,
});

const ACTION_LABELS: Record<string, string> = {
  viewed_user: "Viewed user",
  resolved_crisis_event: "Marked crisis event reviewed",
  replied_support_ticket: "Replied to support ticket",
  granted_role: "Granted role",
  revoked_role: "Revoked role",
};

function AdminAuditPage() {
  const fetchLog = useServerFn(listAdminAuditLog);
  const [adminFilter, setAdminFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-audit-log", adminFilter, actionFilter],
    queryFn: () =>
      fetchLog({
        data: {
          admin_user_id: adminFilter || null,
          action: actionFilter || null,
        },
      }),
    retry: false,
  });

  const selectClass =
    "rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground";

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-2xl">Audit log</h2>
        <p className="text-sm text-muted-foreground">
          Most recent 200 privileged actions. Entries are append-only.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <select
          aria-label="Filter by admin"
          className={selectClass}
          value={adminFilter}
          onChange={(event) => setAdminFilter(event.target.value)}
        >
          <option value="">All admins</option>
          {(data?.admins ?? []).map((admin) => (
            <option key={admin.id} value={admin.id}>
              {admin.name ?? `${admin.id.slice(0, 8)}…`}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by action"
          className={selectClass}
          value={actionFilter}
          onChange={(event) => setActionFilter(event.target.value)}
        >
          <option value="">All actions</option>
          {(data?.actions ?? []).map((action) => (
            <option key={action} value={action}>
              {ACTION_LABELS[action] ?? action}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full rounded-2xl" />
      ) : !data?.entries.length ? (
        <p className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
          No admin actions recorded yet.
        </p>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {data.entries.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
              <span className="font-medium">
                {entry.admin_name ?? `${entry.admin_user_id.slice(0, 8)}…`}
              </span>
              <span className="text-muted-foreground">
                {ACTION_LABELS[entry.action] ?? entry.action}
              </span>
              {entry.target_id && (
                <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                  {entry.target_type}: {entry.target_id.slice(0, 8)}…
                </span>
              )}
              <span className="ml-auto text-xs text-muted-foreground">
                {new Date(entry.created_at).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
