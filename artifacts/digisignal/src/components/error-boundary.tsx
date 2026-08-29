import React, { Component, ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  resetKey?: any;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidUpdate(prevProps: Props) {
    if (this.props.resetKey !== prevProps.resetKey) {
      this.setState({ hasError: false, error: undefined });
    }
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-[50vh] w-full flex-col items-center justify-center gap-4 p-8 text-center animate-in fade-in">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-destructive/10 text-destructive border border-destructive/20 shadow-sm">
            <AlertCircle className="h-8 w-8" />
          </div>
          <div className="max-w-md space-y-2">
            <h2 className="text-xl font-display font-semibold text-foreground">Something went wrong</h2>
            <p className="text-sm text-muted-foreground break-words text-balance">
              {this.state.error?.message || "An unexpected error occurred."}
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => this.setState({ hasError: false, error: undefined })}
            className="mt-4"
          >
            Try again
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
