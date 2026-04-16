import { Head, usePage } from '@inertiajs/react';
import { useCallback, useEffect, useState } from 'react';
import { EmblemPicker } from '@/components/scout/EmblemPicker';
import { LockedChampionsPicker } from '@/components/scout/LockedChampionsPicker';
import { LockedTraitsPicker } from '@/components/scout/LockedTraitsPicker';
import { ScoutControls } from '@/components/scout/ScoutControls';
import { ScoutDebugPanel } from '@/components/scout/ScoutDebugPanel';
import { ScoutErrorBoundary } from '@/components/scout/ScoutErrorBoundary';
import { ScoutResultsList } from '@/components/scout/ScoutResultsList';
import { useScoutWorker } from '@/hooks/use-scout-worker';
import AppLayout from '@/layouts/app-layout';
import type { Champion, ScoredTeam, ScoutContext, Trait } from '@/workers/scout/types';

type Props = {
    setNumber: number;
};

type EmblemEntry = { apiName: string; count: number };
type LockedTrait = { apiName: string; minUnits: number };

function useDebounced<T>(value: T, delayMs: number): T {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), delayMs);

        return () => clearTimeout(timer);
    }, [value, delayMs]);

    return debounced;
}

export default function ScoutIndex(props: Props) {
    return (
        <ScoutErrorBoundary>
            <ScoutIndexInner {...props} />
        </ScoutErrorBoundary>
    );
}

function ScoutIndexInner({ setNumber }: Props) {
    const { generate } = useScoutWorker();
    const page = usePage<{ scoutLabEnabled?: boolean }>();
    const labEnabled = page.props.scoutLabEnabled === true;

    // Context fetched once from the same /api/scout/context the worker
    // hits — lets the UI render pickers before the first generate call.
    const [champions, setChampions] = useState<Champion[]>([]);
    const [traits, setTraits] = useState<Trait[]>([]);
    const [contextStale, setContextStale] = useState(false);

    useEffect(() => {
        fetch('/api/scout/context')
            .then((res) => res.json() as Promise<ScoutContext>)
            .then((ctx) => {
                setChampions(ctx.champions);
                setTraits(ctx.traits);
                setContextStale(ctx.stale);
            });
    }, []);

    const [level, setLevel] = useState(8);
    const [topN, setTopN] = useState(10);
    const [max5Cost, setMax5Cost] = useState<number | null>(null);
    const [minFrontline, setMinFrontline] = useState(0);
    const [minDps, setMinDps] = useState(0);
    const [lockedChampions, setLockedChampions] = useState<string[]>([]);
    const [lockedTraits, setLockedTraits] = useState<LockedTrait[]>([]);
    const [emblems, setEmblems] = useState<EmblemEntry[]>([]);

    const [results, setResults] = useState<ScoredTeam[]>([]);
    const [isRunning, setIsRunning] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const run = useCallback(() => {
        setIsRunning(true);
        setError(null);

        const params = {
            level,
            topN,
            max5Cost,

            minFrontline,
            minDps,
            lockedChampions,
            lockedTraits,
            emblems,
        };
        const startedAt = performance.now();

        generate(params)
            .then((out) => {
                setResults(out.results);
                setIsRunning(false);

                // Fire-and-forget lab ingest so anything the user sees
                // in the UI is also queryable from scout-lab alongside
                // CLI/experiment runs. Backend short-circuits to 204
                // when SCOUT_LAB_ENABLED is not set, so it's safe to
                // always call; we still skip the fetch when the flag
                // is known-off to avoid a pointless roundtrip.
                if (labEnabled) {
                    void fetch('/api/scout/lab/ingest', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            params,
                            results: out.results,
                            source: 'ui',
                            command: 'ui-generate',
                            tag: 'ui-session',
                            durationMs: Math.round(performance.now() - startedAt),
                        }),
                    }).catch(() => {
                        // Lab ingest failures must not surface in the
                        // main UX — this is a debug sidecar, not a
                        // hard dependency.
                    });
                }
            })
            .catch((err) => {
                setError(err.message);
                setIsRunning(false);
            });
    }, [generate, labEnabled, level, topN, max5Cost, minFrontline, minDps, lockedChampions, lockedTraits, emblems]);

    // Serialise params to a stable string key — object literals get a
    // new reference every render, which made useDebounced retrigger in
    // a loop when `run()` itself caused a re-render. A JSON string only
    // changes when a param's actual value changes.
    const paramsKey = JSON.stringify({
        level,
        topN,
        max5Cost,
        minFrontline,
        minDps,
        lockedChampions,
        lockedTraits,
        emblems,
    });
    const debouncedParamsKey = useDebounced(paramsKey, 300);

    useEffect(() => {
        if (champions.length === 0) {
return;
}

        run();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debouncedParamsKey, champions.length]);

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <Head title="Scout — TFT Scout" />
            <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[1fr] gap-4 overflow-hidden p-6 lg:grid-cols-[280px_1fr_300px]">
                <aside className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
                    <ScoutControls
                        level={level}
                        topN={topN}
                        max5Cost={max5Cost}
                        minFrontline={minFrontline}
                        minDps={minDps}
                        isRunning={isRunning}
                        onLevelChange={setLevel}
                        onTopNChange={setTopN}
                        onMax5CostChange={setMax5Cost}
                        onMinFrontlineChange={setMinFrontline}
                        onMinDpsChange={setMinDps}
                        onRun={run}
                    />
                    <LockedChampionsPicker
                        champions={champions}
                        locked={lockedChampions}
                        onChange={setLockedChampions}
                    />
                </aside>

                <main className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
                    {contextStale && (
                        <div className="shrink-0 rounded-lg border border-amber-800/60 bg-amber-950/20 p-3 text-xs text-amber-300">
                            MetaTFT data is older than 24h — a background refresh has been
                            scheduled. Reload the page in a minute to see fresh numbers.
                        </div>
                    )}
                    <div className="min-h-0 flex-1 overflow-y-auto">
                        <ScoutResultsList
                            teams={results}
                            isRunning={isRunning}
                            error={error}
                        />
                    </div>
                </main>

                <aside className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
                    <LockedTraitsPicker
                        traits={traits}
                        locked={lockedTraits}
                        onChange={setLockedTraits}
                    />
                    <EmblemPicker
                        traits={traits}
                        emblems={emblems}
                        onChange={setEmblems}
                    />
                </aside>
            </div>
            <ScoutDebugPanel
                params={{
                    level,
                    topN,
                    max5Cost,
        
                    minFrontline,
                    minDps,
                    lockedChampions,
                    lockedTraits,
                    emblems,
                }}
                results={results}
            />
        </div>
    );
}

ScoutIndex.layout = (page: React.ReactNode) => (
    <AppLayout breadcrumbs={[{ title: 'Scout', href: '/scout' }]}>
        {page}
    </AppLayout>
);
