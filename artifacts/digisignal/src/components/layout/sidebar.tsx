import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { 
  LayoutDashboard, 
  Target, 
  Building2, 
  Workflow, 
  Crosshair, 
  BookOpen, 
  TrendingUp, 
  BrainCircuit,
  Settings,
  Wrench,
  RadioTower,
  ShieldCheck,
} from "lucide-react";
import { useUser, useClerk } from "@clerk/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
  { href: "/opportunities", label: "Opportunities", icon: Target },
  { href: "/companies", label: "Companies", icon: Building2 },
  { href: "/business-twin", label: "Business Twin", icon: Workflow },
  { href: "/icp", label: "Dynamic ICP", icon: Crosshair },
  { href: "/research", label: "Research", icon: BookOpen },
  { href: "/signals", label: "Signals", icon: RadioTower },
  { href: "/outcomes", label: "Outcomes", icon: TrendingUp },
  { href: "/learning", label: "Learning", icon: BrainCircuit },
];

export function Sidebar() {
  const [location] = useLocation();
  const { user } = useUser();
  const { signOut } = useClerk();
  const {
    organizations,
    projects,
    activeOrganizationId,
    activeProjectId,
    setActiveOrganizationId,
    setActiveProjectId,
  } = useWorkspace();
  const logoUrl = `${import.meta.env.BASE_URL}logo.svg`;
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  const { isAdmin } = useAdminAccess();

  return (
    <aside className="hidden h-full w-64 flex-col border-r border-border bg-sidebar text-sidebar-foreground md:flex">
      <div className="p-6">
        <Link href="/today" className="flex items-center gap-2 outline-none">
          <img src={logoUrl} alt="JYRA" className="h-8 w-8" />
          <span className="font-display text-xl font-bold tracking-tight">JYRA</span>
        </Link>
      </div>

      <div className="space-y-2 px-4 pb-4">
        <Select
          value={activeOrganizationId ?? undefined}
          onValueChange={setActiveOrganizationId}
        >
          <SelectTrigger className="border-sidebar-border bg-white/5 text-sidebar-foreground">
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
          <SelectTrigger className="border-sidebar-border bg-white/5 text-sidebar-foreground">
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
                  "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-all duration-200 outline-none",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="border-t border-sidebar-border p-4">
        <nav className="space-y-1 mb-4">
          {isAdmin && (
            <Link
              href="/admin/quality"
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors outline-none",
                location === "/admin/quality"
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
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
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors outline-none",
                location === "/settings/providers"
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
              )}
            >
              <Wrench className="h-4 w-4" />
              Provider diagnostics
            </Link>
          )}
          <Link
            href="/settings"
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors outline-none",
              location === "/settings"
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
            )}
          >
            <Settings className="h-4 w-4" />
            Settings
          </Link>
        </nav>

        <div className="flex items-center gap-3 px-3">
          <Avatar className="h-9 w-9 border border-sidebar-border">
            <AvatarImage src={user?.imageUrl} alt={user?.fullName || ""} />
            <AvatarFallback className="bg-sidebar-accent text-sidebar-accent-foreground">
              {user?.firstName?.charAt(0) || "U"}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-1 flex-col overflow-hidden">
            <span className="truncate text-sm font-medium text-sidebar-foreground">
              {user?.fullName || user?.primaryEmailAddress?.emailAddress}
            </span>
            <button
              onClick={() => signOut({ redirectUrl: basePath || "/" })}
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
