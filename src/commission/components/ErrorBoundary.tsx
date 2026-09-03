import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * A failure should cost you a panel, not the page.
 *
 * React unmounts the whole tree when a render throws, which shows as a blank
 * white window with nothing to report — the worst possible failure for someone
 * trying to work out whether the software is broken or their data is. One
 * document that cannot be priced now says so, in place, with the message.
 */
interface Props { children: ReactNode; label?: string }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept in the console for a report; the panel below is what a person reads.
    console.error('Commission Desk:', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="m-6 card p-5 border-red-200 max-w-[70ch]">
        <h2 className="text-[15px] font-semibold text-red-800">
          {this.props.label ?? 'This view'} could not be shown
        </h2>
        <p className="text-[13px] text-slate-600 mt-1.5">
          Everything already loaded is still here — reopen the page from the
          sidebar. If it happens again, this is the message to send on:
        </p>
        <pre className="mt-3 p-3 rounded-lg bg-surface-muted text-[12px] font-mono text-slate-800 overflow-x-auto whitespace-pre-wrap">
{error.message}
        </pre>
        <button className="btn-secondary mt-3" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    );
  }
}
