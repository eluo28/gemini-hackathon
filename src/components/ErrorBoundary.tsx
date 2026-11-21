import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, errorMessage: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    const raw = typeof error?.message === 'string' ? error.message.trim() : '';
    const summary = raw ? `${error?.name || 'Error'}: ${raw}`.slice(0, 180) : null;
    return { hasError: true, errorMessage: summary };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ClipThat][ErrorBoundary]', {
      ts: new Date().toISOString(),
      name: error?.name,
      message: error?.message,
      stack: error?.stack,
      componentStack: info?.componentStack,
    });
  }

  private handleReset = () => {
    this.setState({ hasError: false, errorMessage: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-white text-slate-950 flex items-center justify-center p-6">
          <div className="max-w-md w-full p-6 rounded-2xl border border-slate-200 bg-[#FAFAFB] text-center space-y-3">
            <h1 className="font-display text-lg font-semibold text-slate-950">
              ClipThat Studio encountered an unexpected error
            </h1>
            <p className="text-sm text-slate-600">
              Your stream connection was paused safely. Try resuming or reload to rejoin the studio room.
            </p>
            {this.state.errorMessage && (
              <p className="text-xs font-mono text-slate-500 bg-white border border-slate-200/80 rounded-xl px-3 py-2 break-words">
                {this.state.errorMessage}
              </p>
            )}
            <div className="flex items-center justify-center gap-2 pt-1">
              <button
                type="button"
                onClick={this.handleReset}
                className="px-4 py-2 text-xs font-semibold bg-white hover:bg-slate-100 text-slate-900 border border-slate-200 rounded-xl transition-colors"
              >
                Try Again
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="px-4 py-2 text-xs font-semibold bg-slate-950 hover:bg-slate-800 text-white rounded-xl transition-colors"
              >
                Reload Studio
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
