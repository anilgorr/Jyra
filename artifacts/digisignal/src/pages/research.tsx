import { Telescope, Lock } from "lucide-react";
import { Link } from "wouter";

export default function Research() {
  return (
    <div className="h-full min-h-[80vh] flex flex-col items-center justify-center max-w-2xl mx-auto text-center space-y-6 animate-in fade-in zoom-in-95 duration-500">
      <div className="relative">
        <div className="w-24 h-24 rounded-2xl bg-secondary/50 flex items-center justify-center rotate-3 transition-transform hover:rotate-6">
          <Telescope className="w-10 h-10 text-primary" />
        </div>
        <div className="absolute -bottom-2 -right-2 w-8 h-8 rounded-full bg-background border-2 border-border flex items-center justify-center">
          <Lock className="w-4 h-4 text-muted-foreground" />
        </div>
      </div>
      
      <div className="space-y-2">
        <h1 className="text-3xl font-display font-semibold tracking-tight text-foreground">
          Research Planner
        </h1>
        <p className="text-lg text-muted-foreground">
          Reserved for the Provider Integration Phase.
        </p>
      </div>
      
      <p className="text-sm text-muted-foreground leading-relaxed max-w-lg">
        The research planner will orchestrate deep dives into qualified companies, automating discovery and structuring market intelligence into actionable briefs.
      </p>

      <div className="pt-8">
        <Link href="/" className="inline-flex items-center gap-2 px-6 py-3 rounded-md bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors shadow-sm">
          Return to Foundation
        </Link>
      </div>
    </div>
  );
}