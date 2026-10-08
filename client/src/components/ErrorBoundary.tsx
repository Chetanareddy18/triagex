import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorState } from './ui';

/** Keeps a render error in one page from blanking the whole app. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI error', error, info.componentStack);
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="card mx-auto mt-10 max-w-lg">
          <ErrorState error={this.state.error} retry={() => window.location.reload()} />
        </div>
      );
    }
    return this.props.children;
  }
}
