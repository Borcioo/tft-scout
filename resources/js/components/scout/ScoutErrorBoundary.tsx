import { Component  } from 'react';
import type {ReactNode} from 'react';

type Props = {
    children: ReactNode;
};

type State = {
    error: Error | null;
};

/**
 * Error boundary for the Scout page. Catches runtime errors from the
 * ported algorithm worker, the hook lifecycle, or any child component
 * so the whole app doesn't unmount when the scout pipeline blows up.
 *
 * React doesn't yet expose a hook-based error boundary, so this stays
 * a class component. Scope is intentionally narrow — only wrap the
 * scout page, not the whole layout — so other pages keep working even
 * if scout is broken.
 */
export class ScoutErrorBoundary extends Component<Props, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        // Surface the stack in dev tools — the production bundle still
        // calls this but DevTools keeps the stack readable via source
        // maps, so we log both so the user can copy either.
         
        console.error('[Scout] crashed:', error, info.componentStack);
    }

    render() {
        if (this.state.error) {
            return (
                <div className="flex flex-col gap-3 p-6">
                    <h1 className="text-2xl font-bold text-red-400">
                        Scout crashed
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        The scout component threw an error. Details below.
                        Reloading the page usually recovers.
                    </p>
                    <pre className="max-h-[50vh] overflow-auto rounded-lg border border-red-800/60 bg-red-950/20 p-3 text-xs text-red-300">
                        {this.state.error.message}
                        {this.state.error.stack ? '\n\n' + this.state.error.stack : ''}
                    </pre>
                    <button
                        type="button"
                        onClick={() => this.setState({ error: null })}
                        className="self-start rounded border border-border px-3 py-1 text-sm hover:bg-muted"
                    >
                        Reset
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}
