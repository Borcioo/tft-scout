import { Head, usePage } from '@inertiajs/react';
import { SlidersHorizontal } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { ItemBuildsMap } from '@/components/scout/ChampionItemBuildsAccordion';
import { EmblemPicker } from '@/components/scout/EmblemPicker';
import { LockedChampionsPicker } from '@/components/scout/LockedChampionsPicker';
import { LockedTraitsPicker } from '@/components/scout/LockedTraitsPicker';
import { ScoutControls } from '@/components/scout/ScoutControls';
import { ScoutDebugPanel } from '@/components/scout/ScoutDebugPanel';
import { ScoutErrorBoundary } from '@/components/scout/ScoutErrorBoundary';
import { ScoutResultsList } from '@/components/scout/ScoutResultsList';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useScoutWorker } from '@/hooks/use-scout-worker';
import {
    csvCodec,
    intCodec,
    keyValueListCodec,
    nullableIntCodec,
    useUrlState,
} from '@/hooks/use-url-state';
import AppLayout from '@/layouts/app-layout';
import type {
    Champion,
    LockIssue,
    ScoredTeam,
    ScoutContext,
    Trait,
} from '@/workers/scout/types';

type Props = {
    setNumber: number;
    itemBuilds: ItemBuildsMap;
    savedPlannerCodes: string[];
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

function ScoutIndexInner({ itemBuilds, savedPlannerCodes }: Props) {
    const { generate } = useScoutWorker();
    const page = usePage<{ scoutLabEnabled?: boolean }>();
    const labEnabled = page.props.scoutLabEnabled === true;

    // Local mirror of saved planner codes — starts from server-passed list
    // and grows with every successful save during the session so cards
    // flip to Saved immediately without a roundtrip.
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

    // URL-persisted state — reload/refresh keeps all filters. Codecs
    // omit default values from the query string so a pristine /scout
    // URL stays clean; any changed param emits exactly one short key.
    const [level, setLevel] = useUrlState(
        'lvl',
        9,
        intCodec(9).parse,
        intCodec(9).serialize,
    );
    const [topN, setTopN] = useUrlState(
        'top',
        10,
        intCodec(10).parse,
        intCodec(10).serialize,
    );
    const [max5Cost, setMax5Cost] = useUrlState<number | null>(
        'max5',
        null,
        nullableIntCodec.parse,
        nullableIntCodec.serialize,
    );
    const [minFrontline, setMinFrontline] = useUrlState(
        'fl',
        0,
        intCodec(0).parse,
        intCodec(0).serialize,
    );
    const [minDps, setMinDps] = useUrlState(
        'dps',
        0,
        intCodec(0).parse,
        intCodec(0).serialize,
    );
    const [lockedChampions, setLockedChampions] = useUrlState<string[]>(
        'lock',
        [],
        csvCodec.parse,
        csvCodec.serialize,
    );
    const [excludedChampions, setExcludedChampions] = useUrlState<string[]>(
        'ban',
        [],
        csvCodec.parse,
        csvCodec.serialize,
    );
    const lockedTraitsCodec = keyValueListCodec<'minUnits'>('minUnits');
    const [lockedTraits, setLockedTraits] = useUrlState<LockedTrait[]>(
        'lockt',
        [],
        lockedTraitsCodec.parse as (raw: string) => LockedTrait[],
        lockedTraitsCodec.serialize as (v: LockedTrait[]) => string | null,
    );
    const emblemsCodec = keyValueListCodec<'count'>('count');
    const [emblems, setEmblems] = useUrlState<EmblemEntry[]>(
        'emb',
        [],
        emblemsCodec.parse as (raw: string) => EmblemEntry[],
        emblemsCodec.serialize as (v: EmblemEntry[]) => string | null,
    );

    const [results, setResults] = useState<ScoredTeam[]>([]);
    const [lockIssues, setLockIssues] = useState<LockIssue[]>([]);
    const [isRunning, setIsRunning] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [filtersOpen, setFiltersOpen] = useState(false);

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
            excludedChampions,
            lockedTraits,
            emblems,
        };
        const startedAt = performance.now();

        generate(params)
            .then((out) => {
                setResults(out.results);
                setLockIssues(out.lockIssues);
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
                            durationMs: Math.round(
                                performance.now() - startedAt,
                            ),
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
    }, [
        generate,
        labEnabled,
        level,
        topN,
        max5Cost,
        minFrontline,
        minDps,
        lockedChampions,
        excludedChampions,
        lockedTraits,
        emblems,
    ]);

    // Lock a unit the level gate kept out (empty-slate suggestion). A lock
    // and a ban are mutually exclusive, like in the picker.
    const lockChampion = useCallback(
        (apiName: string) => {
            if (!lockedChampions.includes(apiName)) {
                setLockedChampions([...lockedChampions, apiName]);
            }
            setExcludedChampions(
                excludedChampions.filter((api) => api !== apiName),
            );
        },
        [
            lockedChampions,
            excludedChampions,
            setLockedChampions,
            setExcludedChampions,
        ],
    );

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
        excludedChampions,
        lockedTraits,
        emblems,
    });
    const debouncedParamsKey = useDebounced(paramsKey, 300);

    // Re-run only when the debounced params or the champion pool change;
    // `run` is recreated every render and would loop the worker.
    // biome-ignore lint/correctness/useExhaustiveDependencies: debounced key is the intended trigger
    useEffect(() => {
        if (champions.length === 0) {
            return;
        }

        run();
    }, [debouncedParamsKey, champions.length]);

    // Each panel renders in the side columns on desktop and in the
    // filters sheet below lg, where three columns don't fit
    const controls = (
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
    );
    const championsPicker = (
        <LockedChampionsPicker
            champions={champions}
            locked={lockedChampions}
            excluded={excludedChampions}
            onChangeLocked={setLockedChampions}
            onChangeExcluded={setExcludedChampions}
        />
    );
    const traitsPicker = (
        <LockedTraitsPicker
            traits={traits}
            locked={lockedTraits}
            onChange={setLockedTraits}
        />
    );
    const emblemPicker = (
        <EmblemPicker traits={traits} emblems={emblems} onChange={setEmblems} />
    );
    const emblemCount = emblems.reduce((n, e) => n + e.count, 0);
    const championCount = lockedChampions.length + excludedChampions.length;
    const activeFilters =
        championCount +
        lockedTraits.length +
        emblemCount +
        (max5Cost !== null ? 1 : 0) +
        (minFrontline > 0 ? 1 : 0) +
        (minDps > 0 ? 1 : 0);
    const summary = [
        `Lvl ${level}`,
        lockedChampions.length > 0 && `${lockedChampions.length} locked`,
        excludedChampions.length > 0 && `${excludedChampions.length} banned`,
        lockedTraits.length > 0 &&
            `${lockedTraits.length} trait${lockedTraits.length > 1 ? 's' : ''}`,
        emblemCount > 0 && `${emblemCount} emblem${emblemCount > 1 ? 's' : ''}`,
        max5Cost !== null && `≤${max5Cost} 5-cost`,
    ]
        .filter(Boolean)
        .join(' · ');

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <Head title="Scout — TFT Scout" />
            <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[1fr] gap-4 overflow-hidden p-3 sm:p-6 lg:grid-cols-[280px_1fr_300px]">
                <aside className="hidden h-full min-h-0 flex-col gap-4 overflow-hidden lg:flex">
                    {controls}
                    {championsPicker}
                </aside>

                <main className="flex h-full min-h-0 flex-col gap-3 overflow-hidden sm:gap-4">
                    <div className="flex shrink-0 items-center gap-3 lg:hidden">
                        <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
                            <SheetTrigger asChild>
                                <Button variant="outline" className="gap-2">
                                    <SlidersHorizontal className="size-4" />
                                    Filters
                                    {activeFilters > 0 && (
                                        <Badge className="h-5 min-w-5 px-1.5">
                                            {activeFilters}
                                        </Badge>
                                    )}
                                </Button>
                            </SheetTrigger>
                            <SheetContent
                                side="bottom"
                                className="gap-0 data-[side=bottom]:h-[90dvh]"
                            >
                                <SheetHeader className="pb-2">
                                    <SheetTitle>Filters</SheetTitle>
                                    <SheetDescription>
                                        Results update as you change them.
                                    </SheetDescription>
                                </SheetHeader>
                                <Tabs
                                    defaultValue="settings"
                                    className="min-h-0 flex-1 px-4"
                                >
                                    <TabsList className="w-full">
                                        <TabsTrigger value="settings">
                                            Settings
                                        </TabsTrigger>
                                        <TabsTrigger value="champions">
                                            Units
                                            {championCount > 0 &&
                                                ` (${championCount})`}
                                        </TabsTrigger>
                                        <TabsTrigger value="traits">
                                            Traits
                                            {lockedTraits.length > 0 &&
                                                ` (${lockedTraits.length})`}
                                        </TabsTrigger>
                                        <TabsTrigger value="emblems">
                                            Emblems
                                            {emblemCount > 0 &&
                                                ` (${emblemCount})`}
                                        </TabsTrigger>
                                    </TabsList>
                                    <TabsContent
                                        value="settings"
                                        className="min-h-0 overflow-y-auto"
                                    >
                                        {controls}
                                    </TabsContent>
                                    <TabsContent
                                        value="champions"
                                        className="flex min-h-0 flex-col"
                                    >
                                        {championsPicker}
                                    </TabsContent>
                                    <TabsContent
                                        value="traits"
                                        className="flex min-h-0 flex-col"
                                    >
                                        {traitsPicker}
                                    </TabsContent>
                                    <TabsContent
                                        value="emblems"
                                        className="flex min-h-0 flex-col"
                                    >
                                        {emblemPicker}
                                    </TabsContent>
                                </Tabs>
                                <SheetFooter>
                                    <Button
                                        onClick={() => setFiltersOpen(false)}
                                    >
                                        {isRunning
                                            ? 'Running…'
                                            : `Show ${results.length} results`}
                                    </Button>
                                </SheetFooter>
                            </SheetContent>
                        </Sheet>
                        <p className="min-w-0 truncate text-muted-foreground text-xs">
                            {summary}
                        </p>
                    </div>
                    {contextStale && (
                        <div className="shrink-0 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 text-xs dark:border-amber-800/60 dark:bg-amber-950/20 dark:text-amber-300">
                            Stats are updating in the background. Reload the
                            page in a minute to see fresh numbers.
                        </div>
                    )}
                    <div className="min-h-0 flex-1 overflow-y-auto">
                        <ScoutResultsList
                            teams={results}
                            isRunning={isRunning}
                            error={error}
                            itemBuilds={itemBuilds}
                            savedCodes={savedCodes}
                            onSaved={markSaved}
                            level={level}
                            emblems={emblems}
                            lockIssues={lockIssues}
                            onLockChampion={lockChampion}
                        />
                    </div>
                </main>

                <aside className="hidden h-full min-h-0 flex-col gap-4 overflow-hidden lg:flex">
                    {traitsPicker}
                    {emblemPicker}
                </aside>
            </div>
            <ScoutDebugPanel
                params={{
                    level,
                    topN,
                    excludedChampions,
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
    <AppLayout
        breadcrumbs={[{ title: 'Scout', href: '/scout' }]}
        scrollMode="inset"
    >
        {page}
    </AppLayout>
);
