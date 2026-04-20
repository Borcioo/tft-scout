import { Head } from '@inertiajs/react';
import { useCallback, useEffect, useState } from 'react';
import type React from 'react';
import { CostTierPicker } from '@/components/random/CostTierPicker';
import { RandomModeTabs } from '@/components/random/RandomModeTabs';
import type { RandomMode } from '@/components/random/RandomModeTabs';
import type { ItemBuildsMap } from '@/components/scout/ChampionItemBuildsAccordion';
import { ScoutCompCard } from '@/components/scout/ScoutCompCard';
import { ScoutErrorBoundary } from '@/components/scout/ScoutErrorBoundary';
import { Button } from '@/components/ui/button';
import { useScoutWorker } from '@/hooks/use-scout-worker';
import AppLayout from '@/layouts/app-layout';
import {
    pickRandomCarry,
    pickRandomFromTeams,
    pickRandomTrait,
} from '@/lib/random-picker';
import type { CostTier } from '@/lib/random-picker';
import type {
    Champion,
    ScoredTeam,
    ScoutContext,
    ScoutParams,
    Trait,
} from '@/workers/scout/types';

// Level hard-coded per spec — random mode always targets the endgame
// board size. Full random uses a wide topN so the random-pick step
// across the result list gives meaningful variety; seeded modes use
// a smaller topN because the lock already narrows the search space.
const LEVEL = 9;
const FULL_RANDOM_TOP_N = 50;
const SEEDED_TOP_N = 10;
const MAX_RETRIES = 3;

type Props = {
    setNumber: number;
    itemBuilds: ItemBuildsMap;
    savedPlannerCodes: string[];
};

type AnchorLabel = { kind: 'carry' | 'trait' | 'full'; label: string };

export default function RandomIndex(props: Props) {
    return (
        <ScoutErrorBoundary>
            <RandomIndexInner {...props} />
        </ScoutErrorBoundary>
    );
}

function RandomIndexInner({ itemBuilds, savedPlannerCodes }: Props) {
    const { generate } = useScoutWorker();

    const [savedCodes, setSavedCodes] = useState<Set<string>>(
        () => new Set(savedPlannerCodes),
    );
    const markSaved = useCallback((code: string) => {
        setSavedCodes((prev) => {
            if (prev.has(code)) {
                return prev;
            }

            const next = new Set(prev);
            next.add(code);

            return next;
        });
    }, []);

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

    const [mode, setMode] = useState<RandomMode>('full');
    const [costTier, setCostTier] = useState<CostTier>('random');
    const [team, setTeam] = useState<ScoredTeam | null>(null);
    const [anchor, setAnchor] = useState<AnchorLabel | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const contextReady = champions.length > 0 && traits.length > 0;

    const randomize = useCallback(async () => {
        if (!contextReady) {
            return;
        }

        setIsRunning(true);
        setError(null);

        try {
            let attempt = 0;

            while (attempt < MAX_RETRIES) {
                attempt++;
                const seed = Math.floor(Math.random() * 2 ** 31);

                if (mode === 'full') {
                    const params: ScoutParams = {
                        level: LEVEL,
                        topN: FULL_RANDOM_TOP_N,
                        seed,
                    };
                    const out = await generate(params);
                    const picked = pickRandomFromTeams(out.results);

                    if (picked) {
                        setTeam(picked);
                        setAnchor({ kind: 'full', label: 'Full random' });

                        return;
                    }

                    continue;
                }

                if (mode === 'carry') {
                    const carry = pickRandomCarry(champions, costTier);

                    if (!carry) {
                        setError('Brak kandydatów dla tego cost tier.');

                        return;
                    }

                    const params: ScoutParams = {
                        level: LEVEL,
                        topN: SEEDED_TOP_N,
                        seed,
                        lockedChampions: [carry.apiName],
                    };
                    const out = await generate(params);
                    const picked = pickRandomFromTeams(out.results);

                    if (picked) {
                        setTeam(picked);
                        setAnchor({
                            kind: 'carry',
                            label: `Carry: ${carry.name}`,
                        });

                        return;
                    }

                    continue;
                }

                // mode === 'trait'
                const traitLock = pickRandomTrait(traits, champions);

                if (!traitLock) {
                    setError('Brak traitów do losowania.');

                    return;
                }

                const params: ScoutParams = {
                    level: LEVEL,
                    topN: SEEDED_TOP_N,
                    seed,
                    lockedTraits: [traitLock],
                };
                const out = await generate(params);
                const picked = pickRandomFromTeams(out.results);

                if (picked) {
                    const traitMeta = traits.find(
                        (t) => t.apiName === traitLock.apiName,
                    );
                    const displayName = traitMeta?.name ?? traitLock.apiName;
                    setTeam(picked);
                    setAnchor({
                        kind: 'trait',
                        label: `Trait: ${displayName} ≥ ${traitLock.minUnits}`,
                    });

                    return;
                }
            }

            setTeam(null);
            setAnchor(null);
            setError(
                'Nie udało się wylosować comp po 3 próbach — spróbuj ponownie.',
            );
        } catch (err) {
            setTeam(null);
            setAnchor(null);
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setIsRunning(false);
        }
    }, [contextReady, mode, costTier, champions, traits, generate]);

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <Head title="Random — TFT Scout" />
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
                <div className="flex flex-wrap items-center gap-3">
                    <RandomModeTabs
                        mode={mode}
                        onChange={setMode}
                        disabled={isRunning}
                    />
                    {mode === 'carry' && (
                        <CostTierPicker
                            value={costTier}
                            onChange={setCostTier}
                            disabled={isRunning}
                        />
                    )}
                </div>

                <div>
                    <Button
                        type="button"
                        onClick={randomize}
                        disabled={!contextReady || isRunning}
                    >
                        {team ? 'Re-roll' : 'Randomize'}
                    </Button>
                </div>

                {error && (
                    <div className="rounded-lg border border-red-800/60 bg-red-950/20 p-3 text-sm text-red-300">
                        {error}
                    </div>
                )}

                {anchor && (
                    <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">
                            {anchor.label}
                        </span>
                    </div>
                )}

                {team && (
                    <ScoutCompCard
                        team={team}
                        itemBuilds={itemBuilds}
                        savedCodes={savedCodes}
                        onSaved={markSaved}
                        level={LEVEL}
                        emblems={[]}
                    />
                )}

                {!team && !isRunning && !error && (
                    <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                        Wybierz tryb i kliknij Randomize.
                    </div>
                )}
            </div>
        </div>
    );
}

RandomIndex.layout = (page: React.ReactNode) => (
    <AppLayout
        breadcrumbs={[{ title: 'Random', href: '/random' }]}
        scrollMode="inset"
    >
        {page}
    </AppLayout>
);
