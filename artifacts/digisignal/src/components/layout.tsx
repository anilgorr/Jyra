import { type ReactNode } from "react";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useHealthCheck } from "@workspace/api-client-react";
import { 
  Activity, 
  Building2, 
  Settings, 
  Telescope,
  Network,
  Menu,
  X
} from "lucide-react";
import { cn } from "@/lib/utils";

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { data: health, isLoading: isHealthLoading } = useHealthCheck();

  const navItems = [
    { href: "/", label: "Foundation", icon: Activity },
    { href: "/signals", label: "Signals", icon: Network },
    { href: "/companies", label: "Companies", icon: Building2 },
    { href: "/research", label: "Research", icon: Telescope },
  ];

  return (
    <div className="flex h-screen bg-background">
      {/* Mobile Navigation Overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="fixed inset-0 bg-black/50" onClick={() => setMobileMenuOpen(false)} />
          <aside className="w-64 bg-sidebar border-r border-sidebar-border text-sidebar-foreground flex flex-col relative z-50">
            <div className="h-16 px-6 flex items-center justify-between border-b border-sidebar-border/20">
              <Link href="/" onClick={() => setMobileMenuOpen(false)} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded bg-sidebar-primary flex items-center justify-center text-sidebar-primary-foreground font-display font-bold text-lg">
                  D
                </div>
                <span className="font-display font-semibold text-lg tracking-wide">
                  DigiSignal
                </span>
              </Link>
              <button onClick={() => setMobileMenuOpen(false)} className="text-sidebar-foreground/70 hover:text-sidebar-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="flex-1 py-6 px-4 flex flex-col gap-1 overflow-y-auto">
              <div className="text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider mb-2 px-2">
                Workspace
              </div>
              {navItems.map((item) => {
                const isActive = location === item.href;
                return (
                  <Link 
                    key={item.href} 
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2 rounded-md transition-all duration-200 group text-sm font-medium",
                      isActive 
                        ? "bg-sidebar-accent text-sidebar-accent-foreground" 
                        : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                    )}
                  >
                    <item.icon className={cn("w-4 h-4", isActive ? "text-sidebar-primary" : "text-sidebar-foreground/50 group-hover:text-sidebar-foreground/80")} />
                    {item.label}
                  </Link>
                );
              })}
            </div>

            <div className="p-4 border-t border-sidebar-border/20 space-y-4">
              <Link 
                href="/settings"
                onClick={() => setMobileMenuOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-sm font-medium",
                  location === "/settings" 
                    ? "bg-sidebar-accent text-sidebar-accent-foreground" 
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                )}
              >
                <Settings className="w-4 h-4" />
                Settings
              </Link>
            </div>
          </aside>
        </div>
      )}

      {/* Desktop Sidebar */}
      <aside className="w-64 bg-sidebar border-r border-sidebar-border text-sidebar-foreground flex flex-col hidden md:flex shrink-0">
        <div className="h-16 px-6 flex items-center border-b border-sidebar-border/20">
          <Link href="/" className="flex items-center gap-3 w-full">
            <div className="w-8 h-8 rounded bg-sidebar-primary flex items-center justify-center text-sidebar-primary-foreground font-display font-bold text-lg">
              D
            </div>
            <span className="font-display font-semibold text-lg tracking-wide">
              DigiSignal
            </span>
          </Link>
        </div>
        
        <div className="flex-1 py-6 px-4 flex flex-col gap-1 overflow-y-auto">
          <div className="text-xs font-semibold text-sidebar-foreground/50 uppercase tracking-wider mb-2 px-2">
            Workspace
          </div>
          {navItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link 
                key={item.href} 
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md transition-all duration-200 group text-sm font-medium",
                  isActive 
                    ? "bg-sidebar-accent text-sidebar-accent-foreground" 
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                )}
              >
                <item.icon className={cn("w-4 h-4", isActive ? "text-sidebar-primary" : "text-sidebar-foreground/50 group-hover:text-sidebar-foreground/80")} />
                {item.label}
              </Link>
            );
          })}
        </div>

        <div className="p-4 border-t border-sidebar-border/20 space-y-4">
          <Link 
            href="/settings"
            className={cn(
              "flex items-center gap-3 px-3 py-2 rounded-md transition-colors text-sm font-medium",
              location === "/settings" 
                ? "bg-sidebar-accent text-sidebar-accent-foreground" 
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
            )}
          >
            <Settings className="w-4 h-4" />
            Settings
          </Link>
          
          <div className="px-3 flex items-center gap-2">
            <div className={cn(
              "w-2 h-2 rounded-full",
              isHealthLoading ? "bg-sidebar-foreground/20 animate-pulse" : 
              health?.status === "ok" ? "bg-emerald-500" : "bg-destructive"
            )} />
            <span className="text-xs text-sidebar-foreground/50 font-medium">
              {isHealthLoading ? "Connecting..." : health?.status === "ok" ? "System Operational" : "System Degraded"}
            </span>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden relative">
        <header className="h-16 border-b border-border bg-card/50 backdrop-blur-sm flex items-center justify-between px-4 md:hidden">
           <Link href="/" className="font-display font-semibold text-lg flex items-center gap-2">
             <div className="w-6 h-6 rounded bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">D</div>
             DigiSignal
           </Link>
           <button onClick={() => setMobileMenuOpen(true)} className="p-2 text-foreground/70 hover:text-foreground bg-muted/50 rounded-md">
             <Menu className="w-5 h-5" />
           </button>
        </header>
        <div className="flex-1 overflow-auto p-4 md:p-8 lg:p-12">
          <div className="max-w-6xl mx-auto h-full">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}