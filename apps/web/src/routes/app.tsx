import { Outlet, createFileRoute, Link } from "@tanstack/react-router";
import { useState, type RefObject } from "react";
import {
  HouseIcon,
  ChatCircleIcon,
  ScrollIcon,
  TreeStructureIcon,
  SparkleIcon,
  LightningIcon,
  ChartLineIcon,
  PlugsConnectedIcon,
  type Icon,
} from "@phosphor-icons/react";
import { cn } from "#/lib/utils";
import { getSidebarPref, SIDEBAR_COOKIE } from "#/server/data.functions";

export const Route = createFileRoute("/app")({
  loader: () => getSidebarPref(),
  component: AppLayout,
});

type NavItem = { to: string; label: string; icon: Icon; soon?: true };
type NavGroup = { label: string; items: NavItem[] };

const navGroups: NavGroup[] = [
  {
    label: "Core",
    items: [
      { to: "/app", label: "Dashboard", icon: HouseIcon },
      { to: "/app/chat", label: "Chat", icon: ChatCircleIcon },
      { to: "/app/quests", label: "Quests", icon: ScrollIcon, soon: true },
      { to: "/app/skills", label: "Skills", icon: TreeStructureIcon, soon: true },
    ],
  },
  {
    label: "Automate",
    items: [
      { to: "/app/companion", label: "Companion", icon: SparkleIcon, soon: true },
      { to: "/app/forge", label: "Forge", icon: LightningIcon, soon: true },
      { to: "/app/analytics", label: "Analytics", icon: ChartLineIcon, soon: true },
      { to: "/app/integrations", label: "Integrations", icon: PlugsConnectedIcon, soon: true },
    ],
  },
];

const mobileNavItems: NavItem[] = [
  { to: "/app", label: "Home", icon: HouseIcon },
  { to: "/app/chat", label: "Chat", icon: ChatCircleIcon },
  { to: "/app/quests", label: "Quests", icon: ScrollIcon, soon: true },
  { to: "/app/skills", label: "Skills", icon: TreeStructureIcon, soon: true },
];

function SidebarNav() {
  return (
    <>
      {navGroups.map((group, groupIndex) => (
        <div key={group.label} className={groupIndex > 0 ? "mt-4" : ""}>
          <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/35">
            {group.label}
          </p>
          <div className="space-y-0.5">
            {group.items.map(({ to, label, icon: IconComponent, soon }) => (
              <Link
                key={to}
                to={to}
                activeOptions={{ exact: to === "/app" }}
                className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground active:bg-sidebar-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring [&[aria-current]]:hover:bg-sidebar-accent [&[aria-current]]:hover:text-sidebar-primary"
                activeProps={{
                  className:
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm bg-sidebar-accent text-sidebar-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                }}
              >
                <IconComponent size={18} weight="regular" />
                {label}
                {soon && (
                  <span className="ml-auto shrink-0 rounded px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider bg-amber-500/10 border border-amber-500/20 text-amber-500/70">
                    Soon
                  </span>
                )}
              </Link>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function MobileBottomNav() {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-sidebar-border bg-sidebar/95 backdrop-blur supports-[backdrop-filter]:bg-sidebar/90 md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="grid h-14 grid-cols-4">
        {mobileNavItems.map(({ to, label, icon: IconComponent, soon }) => (
          <Link
            key={to}
            to={to}
            activeOptions={{ exact: to === "/app" }}
            className="flex flex-col items-center justify-center gap-1 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground active:bg-sidebar-accent/70 [&[aria-current]]:hover:bg-sidebar-accent [&[aria-current]]:hover:text-sidebar-primary [touch-action:manipulation] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar"
            activeProps={{
              className:
                "flex flex-col items-center justify-center gap-1 text-sidebar-primary [touch-action:manipulation] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar",
            }}
          >
            <span className="relative">
              <IconComponent aria-hidden="true" size={18} weight="regular" />
              {soon && (
                <span
                  className="absolute -right-1 -top-1 block h-1.5 w-1.5 rounded-[1px] bg-amber-500/70"
                  aria-hidden="true"
                />
              )}
            </span>
            <span className="text-[11px] font-medium leading-none">{label}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}

interface DesktopSidebarProps {
  open: boolean;
  onToggle: () => void;
}

function DesktopSidebar({ open, onToggle }: DesktopSidebarProps) {
  return (
    // data-open drives ALL states — sidebar wrapper is the single source of truth.
    // group/sidebar-wrapper → hover peek; group/toggle → button hover/focus for icon.
    <div
      data-open={open}
      className="group/sidebar-wrapper relative hidden h-full shrink-0 md:block z-30"
    >
      {/* 1. Trigger Button */}
      <button
        onClick={onToggle}
        className={cn(
          "group/toggle absolute left-full top-3 ml-3 z-40 flex h-8 w-8 items-center justify-center rounded-md",
          "text-sidebar-foreground/60 transition-colors duration-150",
          "hover:bg-sidebar-accent hover:text-sidebar-foreground",
          "bg-sidebar border border-sidebar-border shadow-sm",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
          "group-data-[open=true]/sidebar-wrapper:text-sidebar-foreground",
        )}
        aria-label={open ? "Close sidebar" : "Open sidebar"}
        aria-expanded={open}
      >
        {/* Transparent hover bridge — keeps sidebar visible while moving cursor from button */}
        <div className="absolute -inset-y-4 -left-6 -right-6" aria-hidden="true" />

        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          fill="currentColor"
          viewBox="0 0 256 256"
          aria-hidden="true"
        >
          {/* Outer frame — always static */}
          <path d="M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40ZM40,56H80V200H40ZM216,200H96V56H216V200Z" />
          {/* Inner bar — animates width across all 6 states */}
          <path
            d="M40,56H80V200H40Z"
            className={cn(
              "transition-[clip-path] duration-200 ease-out motion-reduce:transition-none",
              "[clip-path:inset(0_62%_0_0)]",
              "group-hover/toggle:[clip-path:inset(0_32%_0_0)]",
              "group-focus-visible/toggle:[clip-path:inset(0_32%_0_0)]",
              "group-data-[open=true]/sidebar-wrapper:[clip-path:inset(0_0%_0_0)]",
              "group-data-[open=true]/sidebar-wrapper:group-hover/toggle:![clip-path:inset(0_62%_0_0)]",
              "group-data-[open=true]/sidebar-wrapper:group-focus-visible/toggle:![clip-path:inset(0_62%_0_0)]",
            )}
          />
        </svg>
      </button>

      {/* 2. Sidebar Panel */}
      <aside
        className={cn(
          "flex absolute left-0 z-20 w-56 flex-col overflow-hidden",
          "bg-sidebar border-r border-sidebar-border",
          "transition-all duration-300 ease-out",

          // ── Closed (default) ──────────────────────────────────────────────
          "-translate-x-full opacity-0 pointer-events-none",
          "top-14 h-[calc(100vh-3.5rem)]",

          // ── Peek ──────────────────────────────────────────────────────────
          "group-hover/sidebar-wrapper:translate-x-0 group-hover/sidebar-wrapper:opacity-100 group-hover/sidebar-wrapper:pointer-events-auto",
          "group-hover/sidebar-wrapper:rounded-br-xl group-hover/sidebar-wrapper:border-b group-hover/sidebar-wrapper:shadow-2xl",
          "group-focus-visible/toggle:translate-x-0 group-focus-visible/toggle:opacity-100 group-focus-visible/toggle:pointer-events-auto",
          "group-focus-visible/toggle:rounded-br-xl group-focus-visible/toggle:border-b group-focus-visible/toggle:shadow-2xl",
          "focus-within:translate-x-0 focus-within:opacity-100 focus-within:pointer-events-auto",
          "focus-within:rounded-br-xl focus-within:border-b focus-within:shadow-2xl",

          // ── Pinned (data-open=true on wrapper) ───────────────────────────
          "group-data-[open=true]/sidebar-wrapper:!top-0 group-data-[open=true]/sidebar-wrapper:!h-full",
          "group-data-[open=true]/sidebar-wrapper:!translate-x-0 group-data-[open=true]/sidebar-wrapper:!opacity-100 group-data-[open=true]/sidebar-wrapper:!pointer-events-auto",
          "group-data-[open=true]/sidebar-wrapper:!rounded-none group-data-[open=true]/sidebar-wrapper:!border-b-0 group-data-[open=true]/sidebar-wrapper:!shadow-none",
        )}
        aria-label="Primary navigation"
      >
        <div className="flex h-14 shrink-0 items-center border-b border-sidebar-border px-4">
          <Link
            to="/"
            className="font-mono text-sm font-medium tracking-[0.2em] text-sidebar-foreground transition-colors duration-150 hover:text-grind-orange rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            GRIND
          </Link>
        </div>

        <nav className="h-[calc(100%-3rem)] overflow-y-auto px-3 py-3">
          <SidebarNav />
        </nav>
      </aside>
    </div>
  );
}

export function AppLayout() {
  const initialOpen = Route.useLoaderData();
  const [sidebarOpen, setSidebarOpen] = useState(initialOpen);

  const handleToggle = () => {
    const next = !sidebarOpen;
    setSidebarOpen(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next}; path=/; max-age=31536000; SameSite=Lax`;
  };

  return (
    // data-sidebar-open drives the grid column width; CSS transitions it smoothly.
    <div
      data-sidebar-open={sidebarOpen}
      className={cn(
        "group/layout grid h-screen w-full overflow-hidden bg-background",
        "transition-[grid-template-columns] duration-300 ease-out",
        "md:grid-cols-[0px_1fr] md:data-[sidebar-open=true]:grid-cols-[14rem_1fr]",
      )}
    >
      <DesktopSidebar open={sidebarOpen} onToggle={handleToggle} />

      <main className="relative z-10 overflow-hidden pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
        <Outlet />
      </main>

      <MobileBottomNav />
    </div>
  );
}
