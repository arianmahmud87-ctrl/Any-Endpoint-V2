import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Activity, Boxes, Gauge, KeyRound, LogOut, Menu, MessageSquare, PanelLeft, Settings, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSession } from "@/auth/session";
import { useFlags } from "@/lib/api/hooks";
import type { FeatureKey } from "@/lib/api/types";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { DiscordPopup, DiscordSidebarBox, useDiscordInvite, type DiscordInviteState } from "@/components/DiscordInvite";
import { Logo } from "./Logo";

type NavItem = { to: string; label: string; icon: typeof Gauge; feature?: FeatureKey };

const primary: NavItem[] = [
  { to: "/app/playground", label: "Playground", icon: MessageSquare, feature: "playground" },
  { to: "/app/overview", label: "Overview", icon: Gauge },
  { to: "/app/profiles", label: "Profiles", icon: Boxes, feature: "profiles" },
  { to: "/app/keys", label: "Keys", icon: KeyRound, feature: "api_keys" },
  // Token usage only exists for proxy traffic, so it hides together with proxy access.
  { to: "/app/tokens", label: "Token Counter", icon: Activity, feature: "tokens" },
  { to: "/app/settings", label: "Settings", icon: Settings },
];

function Item({ to, label, icon: Icon, onNav }: { to: string; label: string; icon: typeof Gauge; onNav?: () => void }) {
  return (
    <NavLink
      to={to}
      onClick={onNav}
      className={({ isActive }) => cn("flex h-8 items-center gap-2.5 rounded-lg px-2 text-[13.5px] transition hover:bg-sidebar-accent", isActive && "bg-sidebar-accent font-medium")}
    >
      <Icon className="h-[15px] w-[15px]" strokeWidth={1.8} />
      <span className="flex-1">{label}</span>
    </NavLink>
  );
}

function SidebarBody({ onCollapse, onNav, discord }: { onCollapse?: () => void; onNav?: () => void; discord: DiscordInviteState }) {
  const { me } = useSession();
  const flags = useFlags();
  const hidden = new Set(flags.data?.hidden ?? []);
  const all: NavItem[] = me?.role === "admin" ? [...primary, { to: "/app/controller", label: "Controller", icon: SlidersHorizontal }] : primary;
  const nav = all.filter((i) => !i.feature || !hidden.has(i.feature));
  return (
    <div className="flex h-full flex-col px-3 py-3">
      <div className="mb-5 flex items-center justify-between px-1">
        <Logo />
        {onCollapse && (
          <button onClick={onCollapse} className="rounded-md p-1.5 text-muted-foreground hover:bg-sidebar-accent" aria-label="Collapse sidebar">
            <PanelLeft className="h-4 w-4" strokeWidth={1.7} />
          </button>
        )}
      </div>
      <nav className="space-y-0.5">
        {nav.map((i) => <Item key={i.to} {...i} onNav={onNav} />)}
      </nav>
      <DiscordSidebarBox state={discord} />
    </div>
  );
}

function Account() {
  const { me, logout } = useSession();
  const nav = useNavigate();
  const initials = (me?.user.name ?? "?").split(" ").map((s) => s[0]).join("").slice(0, 2);
  const avatar = me?.user.avatar_url ? (
    <img src={me.user.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
  ) : (
    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-[11px] font-medium text-background">{initials}</span>
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account"
        className="rounded-full outline-none transition hover:ring-2 hover:ring-foreground/15 focus-visible:ring-2 focus-visible:ring-foreground/25 data-[state=open]:ring-2 data-[state=open]:ring-foreground/15"
      >
        {avatar}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-60 rounded-xl p-1.5">
        <div className="flex items-center gap-3 px-2.5 py-2">
          {avatar}
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium leading-tight">{me?.user.name}</p>
            <p className="truncate text-[12px] leading-tight text-muted-foreground">{me?.user.email}</p>
          </div>
        </div>
        <DropdownMenuSeparator className="my-1.5" />
        <DropdownMenuItem onClick={() => nav("/app/settings")} className="cursor-pointer gap-2.5 rounded-lg px-2.5 py-2 text-[13px]">
          <Settings className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.8} />
          Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator className="my-1.5" />
        <DropdownMenuItem onClick={() => logout()} className="cursor-pointer gap-2.5 rounded-lg px-2.5 py-2 text-[13px] text-destructive focus:text-destructive">
          <LogOut className="h-3.5 w-3.5" strokeWidth={1.8} />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function AppShell() {
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [mobile, setMobile] = useState<boolean>(false);
  const discord = useDiscordInvite();
  return (
    <div className="flex h-full">
      <aside className={cn("hidden shrink-0 overflow-hidden transition-[width] duration-300 ease-out md:block", collapsed ? "w-0" : "w-[240px]")}>
        <div className="h-full w-[240px]"><SidebarBody onCollapse={() => setCollapsed(true)} discord={discord} /></div>
      </aside>
      <Sheet open={mobile} onOpenChange={setMobile}>
        <SheetContent side="left" className="w-[260px] bg-[hsl(var(--canvas))] p-0">
          <SidebarBody onNav={() => setMobile(false)} discord={discord} />
        </SheetContent>
      </Sheet>
      <main className="relative m-0 flex min-w-0 flex-1 flex-col overflow-hidden bg-background md:my-1.5 md:mr-1.5 md:rounded-2xl md:border">
        <header className="flex h-14 shrink-0 items-center justify-between px-4">
          <div className="flex items-center gap-1">
            <button className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary md:hidden" onClick={() => setMobile(true)} aria-label="Open menu">
              <Menu className="h-4 w-4" />
            </button>
            {collapsed && (
              <button className="hidden rounded-md p-1.5 text-muted-foreground hover:bg-secondary md:block" onClick={() => setCollapsed(false)} aria-label="Expand sidebar">
                <PanelLeft className="h-4 w-4" strokeWidth={1.7} />
              </button>
            )}
          </div>
          <Account />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto"><Outlet /></div>
      </main>
      <DiscordPopup state={discord} />
    </div>
  );
}
