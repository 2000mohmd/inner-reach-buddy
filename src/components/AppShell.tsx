import { Link, useRouterState } from "@tanstack/react-router";
import { Leaf } from "lucide-react";
import { useState, type ReactNode } from "react";
import { SafetyFooter } from "./SafetyFooter";
import { AppSidebar, SIDEBAR_NAV } from "./AppSidebar";

export function AppShell({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="flex min-h-screen w-full bg-background">
      <AppSidebar open={sidebarOpen} onToggle={() => setSidebarOpen((open) => !open)} />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile-only top bar; the rail takes over from md up. */}
        <header className="sticky top-0 z-20 flex items-center gap-1 border-b border-border/70 bg-background/85 px-3 py-2 backdrop-blur md:hidden">
          <Link to="/chat" className="mr-auto flex items-center gap-2 font-display text-lg">
            <Leaf className="size-5 text-primary" aria-hidden />
            Kalm
          </Link>
          {SIDEBAR_NAV.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              aria-label={label}
              className={`rounded-full p-2 ${
                pathname === to
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              <Icon className="size-4" aria-hidden />
            </Link>
          ))}
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
        <SafetyFooter />
      </div>
    </div>
  );
}
