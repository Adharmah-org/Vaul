import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    const raw = error instanceof Error ? error.message : String(error);
    return { hasError: true, message: raw };
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    console.error('Vault ErrorBoundary caught:', error, info);
  }

  render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    let parsedSummary = this.state.message;
    try {
      const parsed = JSON.parse(this.state.message) as {
        error?: string;
        operationType?: string;
        path?: string | null;
      };
      if (parsed && parsed.error) {
        parsedSummary = `Cloud Vault ${parsed.operationType || 'operation'} failed${
          parsed.path ? ` (${parsed.path})` : ''
        }: ${parsed.error}`;
      }
    } catch {
      // plain text error
    }

    return (
      <div className="min-h-screen bg-[#030505] text-[#E6F1EE] flex items-center justify-center p-6">
        <div className="max-w-lg w-full bg-[#090D0D] border border-red-500/35 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base font-bold text-[#E6F1EE]">Vault Runtime Interruption</h1>
              <p className="text-xs text-[#8A9D98] font-sans-ui">
                A storage or permission check halted execution safely.
              </p>
            </div>
          </div>

          <div className="bg-[#030505] border border-white/10 rounded-lg p-3 text-xs text-red-300 break-words">
            {parsedSummary}
          </div>

          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-[#39FF88] text-[#030505] hover:bg-[#52FF99]"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Reload rooh.clouds
          </button>
        </div>
      </div>
    );
  }
}
