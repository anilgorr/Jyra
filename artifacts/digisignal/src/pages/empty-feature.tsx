import { Target, Info } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface EmptyFeatureProps {
  title: string;
  description: string;
}

export default function EmptyFeature({ title, description }: EmptyFeatureProps) {
  return (
    <div className="flex flex-col gap-6 animate-in fade-in duration-500 h-full pb-12">
      <header>
        <h1 className="text-3xl font-display font-bold text-foreground">{title}</h1>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center justify-center text-center max-w-md">
          <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-muted text-muted-foreground/50 shadow-sm border border-border/50">
            <Target className="h-8 w-8" />
          </div>
          
          <h2 className="text-xl font-display font-semibold text-foreground mb-3">
            Not enough data
          </h2>
          
          <p className="text-muted-foreground mb-8 leading-relaxed">
            {description}
          </p>

          <Card className="w-full bg-background border-dashed text-left shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2 font-medium">
                <Info className="h-4 w-4 text-sidebar-accent" />
                Honest Intelligence
              </CardTitle>
            </CardHeader>
            <CardContent>
              <CardDescription className="text-sm">
                DigiSignal intentionally shows empty states rather than inventing fake signals, intent, or companies. When your Business Twin begins recognizing patterns, they will appear here.
              </CardDescription>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
