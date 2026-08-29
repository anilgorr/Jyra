import { Network, Lock } from "lucide-react";
import { Link } from "wouter";

export default function Signals() {
  return (
    <div className="h-full min-h-[80vh] flex flex-col items-center justify-center max-w-2xl mx-auto text-center space-y-6 animate-in fade-in zoom-in-95 duration-500">
      <div className="relative">
        <div className="w-24 h-24 rounded-2xl bg-secondary/50 flex items-center justify-center rotate-3 transition-transform hover:rotate-6">
          <Network className="w-10 h-10 text-primary" />
        </div>
        <div className="absolute -bottom-2 -right-2 w-8 h-8 rounded-full bg-background border-2 border-border flex items-center justify-center">
          <Lock className="w-4 h-4 text-muted-foreground" />
        </div>
      </div>
      
      <div className="space-y-2">
        <h1 className="text-3xl font-display font-semibold tracking-tight text-foreground">
          Signals Workspace
        </h1>
        <p className="text-lg text-muted-foreground">
          Reserved for the Market Intelligence Phase.
        </p>
      </div>
      
      <p className="text-sm text-muted-foreground leading-relaxed max-w-lg">
        This area will track real-time evidence of company intent, financial triggers, and leadership movements. Wait for the foundation to be complete before accessing signal streams.
      </p>

      <div className="pt-8">
        <Link href="/" className="inline-flex items-center gap-2 px-6 py-3 rounded-md bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors shadow-sm">
          Return to Foundation
        </Link>
      </div>
    </div>
  );
}