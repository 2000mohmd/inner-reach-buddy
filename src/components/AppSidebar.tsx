import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Leaf,
  LifeBuoy,
  LineChart,
  LogOut,
  MessageCircle,
  PanelLeft,
  Plus,
  Settings,
  ShieldAlert,
  Wind,
} from "lucide-react";
import type { ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getMyProfile } from "@/lib/onboarding.functions";
import { countUnreviewedCrisisEvents } from "@/lib/admin.functions";

export const SIDEBAR_NAV = [
  { to: "/chat", label: "Companion", icon: MessageCircle },
  { to: "/insights", label: "Progress", icon: LineChart },
  { to: "/exercises", label: "Exercises", icon: Wind },
  { to: "/settings", label: "Profile", icon: Settings },
] as const;

type AppSidebarProps = {
  open: boolean;
  onToggle: () => void;
  /** Optional "New chat" handler — only the companion page passes this. */
  onNewChat?: () => void;
  newChatDisabled?: boolean;
  /** Recents list, rendered under the nav when expanded (chat page only). */
  recents?: ReactNode;
};

/**
 * Shared app rail used on every authenticated page. Collapsed it stays as a
 * narrow icon rail (never fully disappears) so the toggle is always reachable.
 */
export function AppSidebar({
  open,
  onToggle,
  onNewChat,
  newChatDisabled,
  recents,
}: AppSidebarProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const fetchProfile = useServerFn(getMyProfile);
  const { data: profileData } = useQuery({
    queryKey: ["my-profile"],
    queryFn: () => fetchProfile(),
  });
  const preferredName = profileData?.profile?.preferred_name;

  // Admin-only safety queue entry, with an unreviewed count badge.
  const fetchUnreviewed = useServerFn(countUnreviewedCrisisEvents);
  const { data: adminData } = useQuery({
    queryKey: ["admin-crisis-unreviewed"],
    queryFn: () => fetchUnreviewed(),
    retry: false,
    staleTime: 60_000,
  });

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const itemClass = (active: boolean) =>
    `flex items-center gap-2.5 rounded-xl py-2 text-sm transition-colors ${
      open ? "px-2.5" : "justify-center px-0"
    } ${
      active
        ? "bg-sidebar-accent text-sidebar-accent-foreground"
        : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
    }`;

  return (
    <aside
      className={`${
        open ? "w-64" : "w-14"
      } sticky top-0 hidden h-screen shrink-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar transition-[width] duration-300 md:flex`}
    >
      <div className={`flex items-center pt-4 ${open ? "justify-between px-4" : "justify-center"}`}>
        {open && (
          <Link to="/chat" className="flex items-center gap-2 font-display text-xl">
            <Leaf className="size-5 text-primary" aria-hidden />
            Kalm
          </Link>
        )}
        <button
          type="button"
          aria-label={open ? "Hide sidebar" : "Show sidebar"}
          onClick={onToggle}
          className="rounded-lg p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          <PanelLeft className="size-4" aria-hidden />
        </button>
      </div>

      <div className={`pt-4 ${open ? "px-2" : "px-2"} space-y-0.5`}>
        {onNewChat && (
          <button
            type="button"
            onClick={onNewChat}
            disabled={newChatDisabled}
            title="New chat"
            className={`flex w-full items-center gap-2.5 rounded-xl py-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent disabled:opacity-50 ${
              open ? "px-2.5" : "justify-center px-0"
            }`}
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Plus className="size-3.5" aria-hidden />
            </span>
            {open && "New chat"}
          </button>
        )}
        {SIDEBAR_NAV.map(({ to, label, icon: Icon }) => (
          <Link key={to} to={to} title={label} className={itemClass(pathname === to)}>
            <Icon className="size-4 shrink-0" aria-hidden />
            {open && label}
          </Link>
        ))}
        {adminData?.isAdmin && (
          <Link
            to="/admin"
            title="Admin"
            className={itemClass(pathname.startsWith("/admin"))}
          >
            <ShieldAlert className="size-4 shrink-0" aria-hidden />
            {open && <span className="flex-1">Admin</span>}
            {adminData.unreviewed > 0 && (
              <span
                className={`rounded-full bg-crisis px-1.5 py-0.5 text-[10px] font-semibold leading-none text-crisis-foreground ${
                  open ? "" : "absolute"
                }`}
              >
                {adminData.unreviewed}
              </span>
            )}
          </Link>
        )}
        <Link
          to="/crisis"
          title="Immediate support"
          className={`flex items-center gap-2.5 rounded-xl py-2 text-sm text-crisis hover:bg-crisis-surface ${
            open ? "px-2.5" : "justify-center px-0"
          }`}
        >
          <LifeBuoy className="size-4 shrink-0" aria-hidden />
          {open && "Immediate support"}
        </Link>
      </div>

      {recents && open ? (
        <>
          <p className="px-4 pb-1 pt-6 text-xs font-medium text-muted-foreground">Recents</p>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">{recents}</div>
        </>
      ) : (
        <div className="flex-1" />
      )}

      <div
        className={`flex items-center gap-2.5 border-t border-sidebar-border py-3 ${
          open ? "px-3" : "justify-center px-0"
        }`}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
          {(preferredName ?? "K").slice(0, 2).toUpperCase()}
        </span>
        {open && (
          <>
            <span className="min-w-0 flex-1 truncate text-sm">
              {preferredName ?? "Your account"}
            </span>
            <button
              type="button"
              aria-label="Sign out"
              onClick={handleSignOut}
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
            >
              <LogOut className="size-4" aria-hidden />
            </button>
          </>
        )}
      </div>
    </aside>
  );
}
