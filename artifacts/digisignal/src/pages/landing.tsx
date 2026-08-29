import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function Landing() {
  const logoUrl = `${import.meta.env.BASE_URL}logo.svg`;
  return (
    <div className="min-h-[100dvh] flex flex-col bg-background selection:bg-accent/20">
      <header className="flex h-20 items-center justify-between px-8 border-b border-border/40 bg-background/80 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-2">
          <img src={logoUrl} alt="DigiSignal Logo" className="h-8 w-8" />
          <span className="font-display text-2xl font-bold tracking-tight text-foreground">DigiSignal</span>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/sign-in" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
            Sign in
          </Link>
          <Link href="/sign-up" className="inline-flex h-9 items-center justify-center rounded-md bg-foreground px-4 text-sm font-medium text-background transition-colors hover:bg-foreground/90">
            Get Started
          </Link>
        </div>
      </header>

      <main className="flex-1 flex flex-col">
        <section className="flex-1 flex flex-col items-center justify-center px-4 py-24 text-center">
          <div className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1 text-sm font-medium text-muted-foreground mb-8">
            <span className="flex h-2 w-2 rounded-full bg-accent mr-2"></span>
            Intelligence centered on Who, When, and Why.
          </div>
          <h1 className="max-w-4xl font-display text-5xl font-extrabold tracking-tight text-foreground sm:text-6xl md:text-7xl lg:text-8xl">
            B2B buyer intelligence that feels <span className="text-accent">human.</span>
          </h1>
          <p className="mx-auto mt-8 max-w-2xl text-lg text-muted-foreground sm:text-xl">
            Go beyond generic firmographics. DigiSignal builds a dynamic Business Twin and Ideal Customer Profile that learns from your actual project activity.
          </p>
          <div className="mt-12 flex flex-col gap-4 sm:flex-row">
            <Link href="/sign-up" className="inline-flex h-12 items-center justify-center rounded-md bg-accent px-8 text-base font-medium text-accent-foreground shadow-sm transition-colors hover:bg-accent/90">
              Start building your Business Twin
            </Link>
          </div>
        </section>

        <section className="bg-card border-t border-border py-24 px-8">
          <div className="mx-auto max-w-6xl">
            <div className="grid grid-cols-1 gap-12 md:grid-cols-3">
              <div className="flex flex-col">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-sidebar-accent/10 text-sidebar-accent">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                </div>
                <h3 className="mb-2 font-display text-xl font-bold text-foreground">Dynamic ICP</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Stop using static personas. Our dynamic model gathers signals continuously to establish a true baseline of who buys from you.
                </p>
              </div>
              <div className="flex flex-col">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-accent/10 text-accent">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
                </div>
                <h3 className="mb-2 font-display text-xl font-bold text-foreground">Opportunity Intelligence</h3>
                <p className="text-muted-foreground leading-relaxed">
                  Focus on qualified buyers. We sift through the noise to highlight opportunities that have met your specific qualification criteria.
                </p>
              </div>
              <div className="flex flex-col">
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-foreground/5 text-foreground">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
                </div>
                <h3 className="mb-2 font-display text-xl font-bold text-foreground">Tactile Workspace</h3>
                <p className="text-muted-foreground leading-relaxed">
                  A dense but calm environment. Built for daily use without the cognitive overload of a generic enterprise dashboard.
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>
      
      <footer className="border-t border-border bg-background py-8 text-center text-sm text-muted-foreground">
        <p>© {new Date().getFullYear()} DigiSignal. All rights reserved.</p>
      </footer>
    </div>
  );
}
