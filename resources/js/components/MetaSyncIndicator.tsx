import { usePage } from '@inertiajs/react';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * Floating indicator shown bottom-right while a background MetaTFT
 * sync is in flight. Initial state seeded from the Inertia shared
 * `metaSyncRefreshing` prop (set by RevalidateMetaTft middleware the
 * moment it dispatches the job), then kept current by polling
 * `/api/meta-sync/status` every 10s while visible.
 *
 * Polling stops the moment the server reports refreshing=false,
 * leaves one final fade-out tick so the user sees it close cleanly.
 */
export function MetaSyncIndicator() {
    const page = usePage<{ metaSyncRefreshing?: boolean }>();
    const initial = page.props.metaSyncRefreshing === true;
    const [refreshing, setRefreshing] = useState(initial);

    useEffect(() => {
        if (!refreshing) return;

        let cancelled = false;
        const tick = async () => {
            try {
                const res = await fetch('/api/meta-sync/status', {
                    headers: { Accept: 'application/json' },
                    credentials: 'same-origin',
                });
                if (!res.ok) return;
                const json = (await res.json()) as { refreshing: boolean };
                if (!cancelled) setRefreshing(json.refreshing);
            } catch {
                // Swallow — the indicator is non-critical. If the network
                // is flaky we just keep the last known state.
            }
        };

        const id = window.setInterval(tick, 10_000);
        return () => {
            cancelled = true;
            window.clearInterval(id);
        };
    }, [refreshing]);

    if (!refreshing) return null;

    return (
        // Bottom-LEFT on purpose — bottom-right is occupied by the
        // Laravel debug bar toggle in dev, collisions make both icons
        // unusable. Left corner is almost always empty in our layouts.
        <div
            className="pointer-events-none fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-full border border-border/60 bg-card/95 px-3 py-1.5 text-xs text-muted-foreground shadow-lg backdrop-blur"
            role="status"
            aria-live="polite"
            title="MetaTFT stats are being refreshed in the background"
        >
            <Loader2 className="size-3.5 animate-spin text-emerald-400" />
            <span>Refreshing meta stats…</span>
        </div>
    );
}
