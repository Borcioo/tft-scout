import { Head } from '@inertiajs/react';
import { useCallback, useEffect, useState } from 'react';
import AppLayout from '@/layouts/app-layout';
import { EmblemPicker } from '@/components/scout/EmblemPicker';
import { LockedChampionsPicker } from '@/components/scout/LockedChampionsPicker';
import { LockedTraitsPicker } from '@/components/scout/LockedTraitsPicker';
import { ScoutControls } from '@/components/scout/ScoutControls';
import { ScoutErrorBoundary } from '@/components/scout/ScoutErrorBoundary';
import { ScoutResultsList } from '@/components/scout/ScoutResultsList';
import { useScoutWorker } from '@/hooks/use-scout-worker';
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
    const [roleBalance, setRoleBalance] = useState(true);
    const [lockedChampions, setLockedChampions] = useState<string[]>([]);
    const [lockedTraits, setLockedTraits] = useState<LockedTrait[]>([]);
    const [emblems, setEmblems] = useState<EmblemEntry[]>([]);

    const [results, setResults] = useState<ScoredTeam[]>([]);
    const [isRunning, setIsRunning] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const run = useCallback(() => {
        setIsRunning(true);
        setError(null);
        generate({
            level,
            topN,
            max5Cost,
            roleBalance,
            lockedChampions,
            lockedTraits,
            emblems,
        })
            .then((out) => {
                setResults(out.results);
                setIsRunning(false);
            })
            .catch((err) => {
                setError(err.message);
                setIsRunning(false);
            });
    }, [generate, level, topN, max5Cost, roleBalance, lockedChampions, lockedTraits, emblems]);

    // Serialise params to a stable string key — object literals get a
    // new reference every render, which made useDebounced retrigger in
    // a loop when `run()` itself caused a re-render. A JSON string only
    // changes when a param's actual value changes.
    const paramsKey = JSON.stringify({
        level,
        topN,
        max5Cost,
        roleBalance,
        lockedChampions,
        lockedTraits,
        emblems,
    });
    const debouncedParamsKey = useDebounced(paramsKey, 300);

    useEffect(() => {
        if (champions.length === 0) return;
        run();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debouncedParamsKey, champions.length]);

    return (
        <>
            <Head title="Scout — TFT Scout" />
            <div className="grid grid-cols-1 gap-4 p-6 lg:grid-cols-[280px_1fr_300px]">
                <aside className="flex flex-col gap-4">
                    <ScoutControls
                        level={level}
                        topN={topN}
                        max5Cost={max5Cost}
                        roleBalance={roleBalance}
                        isRunning={isRunning}
                        onLevelChange={setLevel}
                        onTopNChange={setTopN}
                        onMax5CostChange={setMax5Cost}
                        onRoleBalanceChange={setRoleBalance}
                        onRun={run}
                    />
                </aside>

                <main className="flex flex-col gap-4">
                    <div className="flex items-baseline justify-between">
                        <h1 className="text-2xl font-bold">
                            Scout (Set {setNumber})
                        </h1>
                        <span className="text-xs text-muted-foreground">
                            {results.length} comps
                        </span>
                    </div>
                    {contextStale && (
                        <div className="rounded-lg border border-amber-800/60 bg-amber-950/20 p-3 text-xs text-amber-300">
                            MetaTFT data is older than 24h — a background refresh has been
                            scheduled. Reload the page in a minute to see fresh numbers.
                        </div>
                    )}
                    <ScoutResultsList
                        teams={results}
                        isRunning={isRunning}
                        error={error}
                    />
                </main>

                <aside className="flex flex-col gap-4">
                    <LockedChampionsPicker
                        champions={champions}
                        locked={lockedChampions}
                        onChange={setLockedChampions}
                    />
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
        </>
    );
}

ScoutIndex.layout = (page: React.ReactNode) => (
    <AppLayout breadcrumbs={[{ title: 'Scout', href: '/scout' }]}>
        {page}
    </AppLayout>
);
