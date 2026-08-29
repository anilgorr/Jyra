import { Button } from "@/components/ui/button";
import { Brain, ArrowRight } from "lucide-react";

export function EmptyState({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] animate-in fade-in duration-700 slide-in-from-bottom-4 max-w-2xl mx-auto text-center px-4">
      <div className="h-20 w-20 rounded-full bg-sidebar-accent/10 flex items-center justify-center mb-6">
        <Brain className="h-10 w-10 text-sidebar-accent" />
      </div>
      <h1 className="text-3xl font-display font-semibold text-foreground mb-4">Build Your Business Twin</h1>
      <p className="text-lg text-muted-foreground mb-8 text-balance">
        The Business Twin acts as a foundational model of your go-to-market motion. By providing deep, structured context about your offering, customers, and market, you enable JYRA to interpret opportunities with analytical precision.
      </p>
      <Button size="lg" onClick={onStart} className="rounded-full px-8 bg-sidebar-accent hover:bg-sidebar-accent/90 text-sidebar-accent-foreground">
        Begin Setup <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </div>
  );
}
