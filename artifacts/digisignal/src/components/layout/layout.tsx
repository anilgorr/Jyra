import { ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { navItems } from "./sidebar";
import { Link } from "wouter";
import { AlertTriangle, Menu, Settings, ShieldCheck, Wrench } from "lucide-react";
import { useWorkspace } from "@/context/workspace-context";
import { useAdminAccess } from "@/hooks/use-admin-access";

export function Layout({ children }: { children: ReactNode }) {
  const { activeProject, isError: workspaceError, errorSource, refetch } = useWorkspace();
  const logoUrl = `${import.meta.env.BASE_URL}logo.svg`;
  const { isAdmin } = useAdminAccess();

  return (
    <div className="flex min-h-[100dvh] w-full overflow-hidden bg-background md:h-[100dvh]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-16 items-center justify-between bg-card px-4 shadow-neu-sm md:hidden">
          <Link href="/today" className="flex items-center gap-2 font-display font-bold">
            <img src={logoUrl} alt="" className="h-7 w-7" />
            JYRA
          </Link>
          <details className="relative">
            <summary className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-xl shadow-neu-sm">
              <Menu className="h-5 w-5" />
              <span className="sr-only">Open navigation</span>
            </summary>
            <nav className="absolute right-0 top-11 w-56 rounded-2xl bg-card p-2 shadow-neu">
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
              {isAdmin && (
                <Link href="/admin/quality" className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted">
                  <ShieldCheck className="h-4 w-4" />
                  Quality dashboard
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
          {workspaceError && (
            <div
              role="alert"
              className="mb-6 flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"
              data-testid="workspace-error"
            >
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-semibold">
                    {errorSource === "organizations" ? "Your organizations could not be loaded." : "Your projects could not be loaded."}
                  </p>
                  <p className="mt-0.5 text-destructive/80">
                    Pages may show stale or empty data until the workspace reconnects.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void refetch()}
                className="shrink-0 self-start rounded-md border border-destructive/30 px-3 py-1.5 font-medium hover:bg-destructive/10 sm:self-auto"
              >
                Try again
              </button>
            </div>
          )}
          {children}
          </div>
        </main>
      </div>
    </div>
  );
}
