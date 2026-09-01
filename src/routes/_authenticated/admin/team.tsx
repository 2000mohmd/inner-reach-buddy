import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ShieldAlert, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { changeUserRole, listTeam, searchUsersForRole } from "@/lib/admin-support.functions";

export const Route = createFileRoute("/_authenticated/admin/team")({
  head: () => ({
    meta: [
      { title: "Team & roles — Kalm admin" },
      {
        name: "description",
        content:
          "Super-admin only: grant or revoke admin access for Kalm, with every change written to the audit log.",
      },
      { property: "og:title", content: "Team & roles — Kalm admin" },
      {
        property: "og:description",
        content: "Manage who can review crisis events and answer support in Kalm.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminTeamPage,
});

type PendingChange = {
  user_id: string;
  role: "admin" | "super_admin";
  grant: boolean;
  label: string;
};

function RoleChips({ roles }: { roles: string[] }) {
  if (!roles.length) return <span className="text-xs text-muted-foreground">Member</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {roles
        .filter((role) => role === "admin" || role === "super_admin")
        .map((role) => (
          <span
            key={role}
            className={`rounded-full px-2 py-0.5 text-[11px] ${
              role === "super_admin"
                ? "bg-destructive/10 text-destructive"
                : "bg-primary/10 text-primary"
            }`}
          >
            {role === "super_admin" ? "Super admin" : "Admin"}
          </span>
        ))}
    </span>
  );
}

function AdminTeamPage() {
  const queryClient = useQueryClient();
  const fetchTeam = useServerFn(listTeam);
  const search = useServerFn(searchUsersForRole);
  const change = useServerFn(changeUserRole);

  const [term, setTerm] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [pending, setPending] = useState<PendingChange | null>(null);

  const team = useQuery({
    queryKey: ["admin-team"],
    queryFn: () => fetchTeam(),
    retry: false,
  });

  const results = useQuery({
    queryKey: ["admin-role-search", submitted],
    queryFn: () => search({ data: { query: submitted } }),
    enabled: submitted.trim().length >= 2,
    retry: false,
  });

  const mutate = useMutation({
    mutationFn: (input: PendingChange) =>
      change({ data: { user_id: input.user_id, role: input.role, grant: input.grant } }),
    onSuccess: async (_result, input) => {
      toast.success(`${input.grant ? "Granted" : "Revoked"} ${input.label}`);
      setPending(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-team"] }),
        queryClient.invalidateQueries({ queryKey: ["admin-role-search"] }),
      ]);
    },
    onError: (error) => {
      setPending(null);
      toast.error(error instanceof Error ? error.message : "Couldn't change that role.");
    },
  });

  if (team.isLoading) return <Skeleton className="h-64 w-full rounded-2xl" />;

  // Server-side gate is authoritative; this is the matching UI state.
  if (team.isError) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6">
        <h2 className="font-display text-xl">Super admins only</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Role management is restricted to super admins — regular admin access doesn't include
          granting or revoking roles.
        </p>
        <Button asChild variant="secondary" className="mt-4">
          <Link to="/admin">Back to overview</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border bg-card p-5">
        <header className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-display text-lg">Current team</h2>
        </header>
        <ul className="mt-3 divide-y divide-border">
          {team.data?.members.map((member) => (
            <li
              key={member.user_id}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {member.preferred_name ?? member.email ?? "Unnamed"}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {member.email ?? member.user_id}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <RoleChips roles={member.roles} />
                {member.roles.includes("admin") ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setPending({
                        user_id: member.user_id,
                        role: "admin",
                        grant: false,
                        label: `admin access for ${member.email ?? member.preferred_name ?? "this member"}`,
                      })
                    }
                  >
                    Revoke admin
                  </Button>
                ) : null}
                {member.roles.includes("super_admin") ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() =>
                      setPending({
                        user_id: member.user_id,
                        role: "super_admin",
                        grant: false,
                        label: `super admin access for ${member.email ?? member.preferred_name ?? "this member"}`,
                      })
                    }
                  >
                    Revoke super admin
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        {!team.data?.members.length ? (
          <p className="mt-3 text-sm text-muted-foreground">No admins yet.</p>
        ) : null}
      </section>

      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="font-display text-lg">Grant access</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Search by account email or preferred name. Every grant and revoke is written to the audit
          log.
        </p>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(term);
          }}
        >
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="name@example.com"
          />
          <Button type="submit" disabled={term.trim().length < 2}>
            Search
          </Button>
        </form>

        {results.isFetching ? (
          <Skeleton className="mt-4 h-20 w-full rounded-xl" />
        ) : results.data ? (
          results.data.results.length ? (
            <ul className="mt-4 divide-y divide-border">
              {results.data.results.map((user) => (
                <li
                  key={user.user_id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {user.preferred_name ?? user.email ?? "Unnamed"}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {user.email ?? user.user_id}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <RoleChips roles={user.roles} />
                    {!user.roles.includes("admin") ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          setPending({
                            user_id: user.user_id,
                            role: "admin",
                            grant: true,
                            label: `admin access to ${user.email ?? user.preferred_name ?? "this member"}`,
                          })
                        }
                      >
                        Make admin
                      </Button>
                    ) : null}
                    {!user.roles.includes("super_admin") ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() =>
                          setPending({
                            user_id: user.user_id,
                            role: "super_admin",
                            grant: true,
                            label: `super admin access to ${user.email ?? user.preferred_name ?? "this member"}`,
                          })
                        }
                      >
                        Make super admin
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">No matching accounts.</p>
          )
        ) : null}
      </section>

      <AlertDialog
        open={Boolean(pending)}
        onOpenChange={(open) => (open ? null : setPending(null))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {pending?.role === "super_admin" ? (
                <ShieldAlert className="h-4 w-4 text-destructive" />
              ) : null}
              {pending?.grant ? "Grant" : "Revoke"}{" "}
              {pending?.role === "super_admin" ? "super admin" : "admin"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.role === "super_admin"
                ? "Super admin is the highest privilege in Kalm — it controls who else can administer the app. Confirm you intend to "
                : "This changes who can review crisis events, read member summaries and answer support. Confirm you intend to "}
              {pending?.grant ? "grant " : "revoke "}
              {pending?.label}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => pending && mutate.mutate(pending)}
              disabled={mutate.isPending}
            >
              {mutate.isPending ? "Saving…" : "Confirm"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
