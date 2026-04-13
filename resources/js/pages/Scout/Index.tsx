import { Head } from '@inertiajs/react';
import { useCallback, useEffect, useState } from 'react';
import AppLayout from '@/layouts/app-layout';
import { EmblemPicker } from '@/components/scout/EmblemPicker';
import { LockedChampionsPicker } from '@/components/scout/LockedChampionsPicker';
import { LockedTraitsPicker } from '@/components/scout/LockedTraitsPicker';
import { ScoutControls } from '@/components/scout/ScoutControls';
import { ScoutResultsList } from '@/components/scout/ScoutResultsList';
import { useScoutWorker } from '@/hooks/use-scout-worker';
import type { Champion, ScoredTeam, ScoutContext, Trait } from '@/workers/scout/types';

type Props = {
    setNumber: number;
};

type EmblemEntry = { apiName: string; count: number };
type LockedTrait = { apiName: string; minUnits: number };

export default function ScoutIndex({ setNumber }: Props) {
    const { generate } = useScoutWorker();

    // Context fetched once from the same /api/scout/context the worker
    // hits — lets the UI render pickers before the first generate call.
    const [champions, setChampions] = useState<Champion[]>([]);
    const [traits, setTraits] = useState<Trait[]>([]);

    useEffect(() => {
        fetch('/api/scout/context')
            .then((res) => res.json() as Promise<ScoutContext>)
            .then((ctx) => {
                setChampions(ctx.champions);
                setTraits(ctx.traits);
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

    // Auto-run on first context load.
    useEffect(() => {
        if (champions.length > 0 && results.length === 0) {
            run();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [champions.length]);

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
