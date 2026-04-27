import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  handleReset = (): void => {
    this.setState({ error: null });
  };

  handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex h-full min-h-[60vh] items-center justify-center p-6">
          <div className="max-w-md w-full rounded-lg border border-destructive/40 bg-destructive/5 p-6 space-y-4">
            <h2 className="text-lg font-semibold">Something went wrong.</h2>
            <p className="text-sm text-muted-foreground">
              {this.state.error.message || 'An unexpected error occurred while rendering this view.'}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={this.handleReset}
                className="px-3 py-1.5 text-sm rounded-md border bg-background hover:bg-accent"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={this.handleReload}
                className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
              >
                Reload app
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
