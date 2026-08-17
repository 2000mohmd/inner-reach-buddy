import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { amIAdmin } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminLayout,
});

const ADMIN_NAV = [
  { to: "/admin", label: "Overview", exact: true },
  { to: "/admin/users", label: "Users", exact: false },
  { to: "/admin/crisis", label: "Crisis", exact: false },
  { to: "/admin/audit", label: "Audit log", exact: false },
] as const;

function AdminLayout() {
  const checkAdmin = useServerFn(amIAdmin);
  const { data, isLoading } = useQuery({
    queryKey: ["admin-status"],
    queryFn: () => checkAdmin(),
    retry: false,
    staleTime: 60_000,
  });

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-6xl space-y-6 px-1">
        <header className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Internal
          </p>
          <h1 className="font-display text-3xl">Kalm admin</h1>
        </header>

        {isLoading ? (
          <Skeleton className="h-24 w-full rounded-2xl" />
        ) : data?.isAdmin === false ? (
          <div className="rounded-2xl border border-border bg-card p-6">
            <h2 className="font-display text-xl">Not available</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              This area is for administrators only.
            </p>
            <Button asChild variant="secondary" className="mt-4">
              <Link to="/chat">Back to Kalm</Link>
            </Button>
          </div>
        ) : (
          <>
            <nav className="flex flex-wrap gap-1 rounded-xl border border-border bg-card p-1">
              {ADMIN_NAV.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  activeOptions={{ exact: item.exact }}
                  className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted data-[status=active]:bg-secondary data-[status=active]:text-secondary-foreground"
                >
                  {item.label}
                </Link>
              ))}
              <span className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground/50">
                Support (soon)
              </span>
              <span className="rounded-lg px-3 py-1.5 text-sm text-muted-foreground/50">
                Team (soon)
              </span>
            </nav>
            <Outlet />
          </>
        )}
      </div>
    </AppShell>
  );
}
