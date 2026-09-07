import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { 
  LayoutDashboard, 
  Target, 
  Building2, 
  Workflow, 
  Crosshair, 
  BookOpen,
  Settings,
  Wrench,
  RadioTower,
  ShieldCheck,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuthSession } from "@/lib/auth";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspace } from "@/context/workspace-context";
import { useAdminAccess } from "@/hooks/use-admin-access";

export const navItems = [
  { href: "/today", label: "Today", icon: LayoutDashboard },
  { href: "/companies", label: "Companies", icon: Building2 },
  { href: "/opportunities", label: "Opportunities", icon: Target },
  { href: "/research", label: "Research", icon: BookOpen },
  { href: "/signals", label: "Signals", icon: RadioTower },
  { href: "/business-twin", label: "Business Twin", icon: Workflow },
  { href: "/icp", label: "Dynamic ICP", icon: Crosshair },
];

export function Sidebar() {
  const [location] = useLocation();
  const { user, mode: authMode, signOut } = useAuthSession();
  const {
    organizations,
    projects,
    activeOrganizationId,
    activeProjectId,
    setActiveOrganizationId,
    setActiveProjectId,
  } = useWorkspace();
  const logoUrl = `${import.meta.env.BASE_URL}logo.svg`;
  const { isAdmin } = useAdminAccess();

  return (
    <aside className="hidden h-full w-64 flex-col bg-sidebar text-sidebar-foreground shadow-neu md:flex">
      <div className="p-6">
        <Link href="/today" className="flex items-center gap-3 outline-none">
          <img src={logoUrl} alt="JYRA" className="h-10 w-10 rounded-xl shadow-neu-primary" />
          <span className="font-display text-xl font-extrabold tracking-tight">JYRA</span>
        </Link>
      </div>

      <div className="space-y-2 px-4 pb-4">
        <Select
          value={activeOrganizationId ?? undefined}
          onValueChange={setActiveOrganizationId}
        >
          <SelectTrigger className="text-sidebar-foreground">
            <SelectValue placeholder="Select organization" />
          </SelectTrigger>
          <SelectContent>
            {organizations.map((organization) => (
              <SelectItem key={organization.id} value={organization.id}>
                {organization.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={activeProjectId ?? undefined}
          onValueChange={setActiveProjectId}
          disabled={projects.length === 0}
        >
          <SelectTrigger className="text-sidebar-foreground">
            <SelectValue placeholder="No project yet" />
          </SelectTrigger>
          <SelectContent>
            {projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex-1 overflow-y-auto py-4">
        <nav className="space-y-1 px-3">
          {navItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-all duration-200 outline-none",
                  isActive
                    ? "bg-sidebar text-sidebar-accent-foreground shadow-neu-inset"
                    : "text-sidebar-foreground/70 hover:text-primary hover:shadow-neu-sm"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="p-4">
        <nav className="space-y-1 mb-4">
          {isAdmin && (
            <Link
              href="/admin/quality"
              className={cn(
                "flex items-center gap-3 rounded-xl px-3.5 py-2 text-sm font-semibold transition-all outline-none",
                location === "/admin/quality"
                  ? "bg-sidebar text-sidebar-accent-foreground shadow-neu-inset"
                  : "text-sidebar-foreground/70 hover:text-primary hover:shadow-neu-sm"
              )}
            >
              <ShieldCheck className="h-4 w-4" />
              Quality dashboard
            </Link>
          )}
          {import.meta.env.DEV && (
            <Link
              href="/settings/providers"
              className={cn(
                "flex items-center gap-3 rounded-xl px-3.5 py-2 text-sm font-semibold transition-all outline-none",
                location === "/settings/providers"
                  ? "bg-sidebar text-sidebar-accent-foreground shadow-neu-inset"
                  : "text-sidebar-foreground/70 hover:text-primary hover:shadow-neu-sm"
              )}
            >
              <Wrench className="h-4 w-4" />
              Provider diagnostics
            </Link>
          )}
          <Link
            href="/settings"
            className={cn(
              "flex items-center gap-3 rounded-xl px-3.5 py-2 text-sm font-semibold transition-all outline-none",
              location === "/settings"
                ? "bg-sidebar text-sidebar-accent-foreground shadow-neu-inset"
                : "text-sidebar-foreground/70 hover:text-primary hover:shadow-neu-sm"
            )}
          >
            <Settings className="h-4 w-4" />
            Settings
          </Link>
        </nav>

        {authMode === "local" && (
          <div className="mb-3 px-3">
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-200"
              title="VITE_JYRA_AUTH_MODE=local: no sign-in; every request runs as the fixed local developer. Development only."
              data-testid="local-auth-mode-pill"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" aria-hidden="true" />
              Local auth mode
            </span>
          </div>
        )}
        <div className="flex items-center gap-3 px-3">
          <Avatar className="h-9 w-9 shadow-neu-sm">
            <AvatarImage src={user?.imageUrl ?? undefined} alt={user?.displayName || ""} />
            <AvatarFallback className="bg-linear-to-br from-primary to-primary-deep text-primary-foreground font-display font-bold">
              {user?.displayName?.charAt(0) || "U"}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-1 flex-col overflow-hidden">
            <span className="truncate text-sm font-medium text-sidebar-foreground">
              {user?.displayName || user?.email}
            </span>
            <button
              onClick={() => void signOut()}
              className="text-left text-xs text-sidebar-foreground/60 hover:text-sidebar-foreground outline-none"
            >
              Log out
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
