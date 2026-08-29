import { ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { navItems } from "./sidebar";
import { Link } from "wouter";
import { Menu, Settings, Wrench } from "lucide-react";
import { useWorkspace } from "@/context/workspace-context";

export function Layout({ children }: { children: ReactNode }) {
  const { activeProject } = useWorkspace();
  const logoUrl = `${import.meta.env.BASE_URL}logo.svg`;

  return (
    <div className="flex min-h-[100dvh] w-full overflow-hidden bg-background md:h-[100dvh]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-border bg-card px-4 md:hidden">
          <Link href="/today" className="flex items-center gap-2 font-display font-bold">
            <img src={logoUrl} alt="" className="h-7 w-7" />
            JYRA
          </Link>
          <details className="relative">
            <summary className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-md border border-border">
              <Menu className="h-5 w-5" />
              <span className="sr-only">Open navigation</span>
            </summary>
            <nav className="absolute right-0 top-11 w-56 rounded-lg border border-border bg-card p-2 shadow-xl">
              <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {activeProject?.name ?? "Workspace"}
              </p>
              {navItems.map((item) => (
                <Link key={item.href} href={item.href} className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted">
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Link>
              ))}
              {import.meta.env.DEV && (
                <Link href="/settings/providers" className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted">
                  <Wrench className="h-4 w-4" />
                  Provider diagnostics
                </Link>
              )}
              <Link href="/settings" className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted">
                <Settings className="h-4 w-4" />
                Settings
              </Link>
            </nav>
          </details>
        </header>
        <main className="flex-1 overflow-y-auto bg-background/50">
          <div className="mx-auto h-full max-w-6xl p-4 sm:p-6 lg:p-8">
          {children}
          </div>
        </main>
      </div>
    </div>
  );
}
