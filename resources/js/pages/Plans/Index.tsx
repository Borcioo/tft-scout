import { Head, router } from '@inertiajs/react';
import { AlertTriangle, Check, Copy, Minus, ShieldPlus, Trash2, TrendingDown, TrendingUp } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { PlansFilterBar, type ChampOption, type TraitOption } from '@/components/plans/PlansFilterBar';
import type { ItemBuildsMap } from '@/components/scout/ChampionItemBuildsAccordion';
import { CompCardBody } from '@/components/scout/CompCardBody';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useScoutWorker } from '@/hooks/use-scout-worker';
import AppLayout from '@/layouts/app-layout';
import { generatePlannerCode } from '@/lib/plannerCode';
import { cn } from '@/lib/utils';
import type { ScoredTeam, Trait } from '@/workers/scout/types';

type Slot = {
    champion_api_name: string;
    star_level?: number;
};

type PlanMeta = {
    score?: number;
    activeTraits?: Trait[];
    roles?: ScoredTeam['roles'];
    insights?: ScoredTeam['insights'];
    metaMatch?: ScoredTeam['metaMatch'];
    params?: { level: number; emblems: string[] };
};

type LiveScore =
    | { status: 'loading' }
    | { status: 'ready'; score: number | null; missing: number }
    | { status: 'error' };

type Plan = {
    id: number;
    name: string;
    notes: string | null;
    slots: Slot[];
    plannerCode: string | null;
    meta: PlanMeta | null;
    updatedAt: string | null;
};

type ChampInfo = {
    apiName: string;
    name: string;
    cost: number;
    icon: string;
    plannerCode: number | null;
    baseApiName: string | null;
    variant: string | null;
};

type Props = {
    plans: Plan[];
    championLookup: Record<string, ChampInfo>;
    traitFilter: TraitOption[];
    itemBuilds: ItemBuildsMap;
};

function getCsrfToken(): string {
    return (
        document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? ''
    );
}

/**
 * Reconstruct a ScoredTeam-shaped object from a stored Plan so it can feed
 * CompCardBody. Champions come from the server-side lookup (authoritative
 * names/icons/costs); the rest comes from the meta snapshot captured at
 * save time.
 */
function planToTeam(plan: Plan, lookup: Record<string, ChampInfo>): ScoredTeam {
    const champions = plan.slots
        .map((s) => {
            const info = lookup[s.champion_api_name];
            return info
                ? {
                      apiName: info.apiName,
                      name: info.name,
                      cost: info.cost,
                      icon: info.icon,
                      plannerCode: info.plannerCode,
                      baseApiName: info.baseApiName,
                      variant: info.variant,
                  }
                : null;
        })
        .filter((c): c is NonNullable<typeof c> => c !== null);

    const meta = plan.meta ?? {};

    return {
        champions,
        activeTraits: meta.activeTraits ?? [],
        roles: meta.roles ?? null,
        score: meta.score ?? 0,
        insights: meta.insights ?? [],
        metaMatch: meta.metaMatch ?? null,
    } as unknown as ScoredTeam;
}

/** Renders the live-vs-snapshot delta next to the snapshot score. */
function ScoreDelta({
    snapshot,
    live,
}: {
    snapshot: number;
    live: LiveScore | undefined;
}) {
    if (!live || live.status === 'loading') {
        return (
            <span
                className="font-mono text-xs text-muted-foreground"
                title="Recalculating with current data…"
            >
                …
            </span>
        );
    }
    if (live.status === 'error') {
        return null;
    }
    if (live.score === null) {
        return (
            <span
                className="inline-flex items-center gap-0.5 font-mono text-xs text-amber-400"
                title={`${live.missing} champion${live.missing === 1 ? '' : 's'} missing from current pool (patch change?)`}
            >
                <AlertTriangle className="size-3" />
                {live.missing} missing
            </span>
        );
    }

    const delta = live.score - snapshot;
    const rounded = Math.round(delta * 10) / 10;
    const abs = Math.abs(rounded).toFixed(1);

    if (rounded === 0) {
        return (
            <span
                className="inline-flex items-center gap-0.5 font-mono text-xs text-muted-foreground"
                title={`Live score ${live.score.toFixed(2)} matches snapshot`}
            >
                <Minus className="size-3" />
                0
            </span>
        );
    }

    const up = rounded > 0;
    return (
        <span
            className={cn(
                'inline-flex items-center gap-0.5 font-mono text-xs',
                up ? 'text-emerald-400' : 'text-red-400',
            )}
            title={`Live ${live.score.toFixed(2)} vs snapshot ${snapshot.toFixed(2)}`}
        >
            {up ? (
                <TrendingUp className="size-3" />
            ) : (
                <TrendingDown className="size-3" />
            )}
            {up ? '+' : '−'}
            {abs}
        </span>
    );
}

export default function PlansIndex({
    plans,
    championLookup,
    traitFilter,
    itemBuilds,
}: Props) {
    const [copiedId, setCopiedId] = useState<number | null>(null);
    const [deletingId, setDeletingId] = useState<number | null>(null);
    const [liveScores, setLiveScores] = useState<Record<number, LiveScore>>({});
    const { rescore } = useScoutWorker();

    // ── Filters ─────────────────────────────────────────────────
    const [query, setQuery] = useState('');
    const [selectedChampions, setSelectedChampions] = useState<string[]>([]);
    const [selectedTraits, setSelectedTraits] = useState<string[]>([]);

    // Champion filter options: every unique champ across user's plans,
    // hydrated from championLookup. Sorted cost ASC, then name.
    const championOptions = useMemo<ChampOption[]>(() => {
        const seen = new Set<string>();
        for (const p of plans) {
            for (const s of p.slots) {
                if (s.champion_api_name) seen.add(s.champion_api_name);
            }
        }
        return Array.from(seen)
            .map((api) => {
                const info = championLookup[api];
                if (!info) return null;
                return {
                    apiName: info.apiName,
                    name: info.name,
                    cost: info.cost,
                    icon: info.icon,
                };
            })
            .filter((c): c is ChampOption => c !== null)
            .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
    }, [plans, championLookup]);

    const filteredPlans = useMemo(() => {
        const q = query.trim().toLowerCase();
        const champSet = new Set(selectedChampions);
        const traitSet = new Set(selectedTraits);

        return plans.filter((plan) => {
            const champApis = plan.slots
                .map((s) => s.champion_api_name)
                .filter(Boolean);
            const traitApis = (plan.meta?.activeTraits ?? []).map(
                (t) => t.apiName,
            );

            // Multiselect: plan must contain EVERY selected champ/trait (AND).
            if (champSet.size > 0) {
                for (const api of champSet) {
                    if (!champApis.includes(api)) return false;
                }
            }
            if (traitSet.size > 0) {
                for (const api of traitSet) {
                    if (!traitApis.includes(api)) return false;
                }
            }

            // Text search: plan name, any trait name, any champ name.
            if (q !== '') {
                const haystack = [
                    plan.name,
                    ...(plan.meta?.activeTraits ?? []).map((t) => t.name),
                    ...champApis.map(
                        (api) => championLookup[api]?.name ?? api,
                    ),
                ]
                    .join(' ')
                    .toLowerCase();
                if (!haystack.includes(q)) return false;
            }

            return true;
        });
    }, [plans, championLookup, query, selectedChampions, selectedTraits]);

    // Recompute score for every plan using the current scoring context.
    // Each plan is scored with the params captured at save time (level,
    // emblems) so the delta reflects patch/data drift only, not a change
    // in how the user configured Scout.
    useEffect(() => {
        let cancelled = false;
        if (plans.length === 0) return;

        setLiveScores((prev) => {
            const next = { ...prev };
            for (const p of plans) {
                if (!next[p.id]) next[p.id] = { status: 'loading' };
            }
            return next;
        });

        (async () => {
            for (const plan of plans) {
                if (cancelled) return;
                const params = plan.meta?.params;
                const champs = plan.slots
                    .map((s) => s.champion_api_name)
                    .filter(Boolean);

                // Legacy plans saved before params were captured: show no delta.
                if (!params || champs.length === 0) {
                    setLiveScores((prev) => ({
                        ...prev,
                        [plan.id]: { status: 'ready', score: null, missing: 0 },
                    }));
                    continue;
                }

                try {
                    const res = await rescore({
                        championApis: champs,
                        level: params.level,
                        emblems: params.emblems,
                    });
                    if (cancelled) return;
                    setLiveScores((prev) => ({
                        ...prev,
                        [plan.id]: {
                            status: 'ready',
                            score: res.score,
                            missing: res.missing,
                        },
                    }));
                } catch {
                    if (cancelled) return;
                    setLiveScores((prev) => ({
                        ...prev,
                        [plan.id]: { status: 'error' },
                    }));
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [plans, rescore]);

    const handleCopy = async (plan: Plan) => {
        // Prefer the code stored at save time (authoritative); fall back
        // to generating from champions if a legacy row predates the column.
        const code =
            plan.plannerCode ??
            generatePlannerCode(
                plan.slots
                    .map((s) => s.champion_api_name)
                    .filter(Boolean)
                    .map((apiName) => ({
                        apiName,
                        plannerCode: championLookup[apiName]?.plannerCode ?? null,
                    })),
            );

        if (!code) {
            toast.error('No planner code available for this plan');
            return;
        }
        try {
            await navigator.clipboard.writeText(code);
            setCopiedId(plan.id);
            toast.success('Code copied');
            setTimeout(() => setCopiedId(null), 1500);
        } catch {
            toast.error('Copy failed');
        }
    };

    const handleDelete = async (plan: Plan) => {
        if (!confirm(`Delete "${plan.name}"?`)) return;
        setDeletingId(plan.id);
        try {
            const res = await fetch(`/api/plans/${plan.id}`, {
                method: 'DELETE',
                headers: {
                    'X-CSRF-TOKEN': getCsrfToken(),
                    Accept: 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                },
                credentials: 'same-origin',
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            toast.success('Deleted');
            router.reload({ only: ['plans', 'championLookup'] });
        } catch {
            toast.error('Delete failed');
        } finally {
            setDeletingId(null);
        }
    };

    return (
        <>
            <Head title="My Plans — TFT Scout" />

            <div className="flex flex-col gap-6 p-6">
                <div className="sticky top-0 z-20 -mx-6 -mt-6 flex flex-col gap-3 bg-background/95 px-6 pb-3 pt-6 backdrop-blur supports-[backdrop-filter]:bg-background/75">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">My Plans</h1>
                        <p className="text-sm text-muted-foreground">
                            Your saved team compositions. Save new ones from the Scout page.
                        </p>
                    </div>

                    {plans.length > 0 && (
                        <PlansFilterBar
                            query={query}
                            onQueryChange={setQuery}
                            championOptions={championOptions}
                            selectedChampions={selectedChampions}
                            onChampionsChange={setSelectedChampions}
                            traitOptions={traitFilter}
                            selectedTraits={selectedTraits}
                            onTraitsChange={setSelectedTraits}
                            matchedCount={filteredPlans.length}
                            totalCount={plans.length}
                        />
                    )}
                </div>

                {plans.length === 0 ? (
                    <Card className="flex flex-col items-center gap-3 p-10 text-center">
                        <div className="flex size-10 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                            <ShieldPlus className="size-5" />
                        </div>
                        <h2 className="text-lg font-semibold">No plans yet</h2>
                        <p className="max-w-md text-sm text-muted-foreground">
                            Run Scout and click the ★ Save button on any comp to save it here.
                        </p>
                    </Card>
                ) : (
                    <>

                        {filteredPlans.length === 0 ? (
                            <Card className="flex flex-col items-center gap-2 p-8 text-center">
                                <p className="text-sm font-medium">
                                    No plans match your filters
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    Try clearing filters or adjusting your search.
                                </p>
                            </Card>
                        ) : (
                            <div className="flex flex-col gap-4">
                                {filteredPlans.map((plan) => {
                            const team = planToTeam(plan, championLookup);

                            return (
                                <div key={plan.id} className="flex flex-col gap-1">
                                    <div className="flex items-center justify-between gap-2 px-1">
                                        <div className="min-w-0">
                                            <h3 className="truncate text-sm font-semibold">
                                                {plan.name}
                                            </h3>
                                            {plan.updatedAt && (
                                                <p className="text-xs text-muted-foreground">
                                                    Saved{' '}
                                                    {new Date(plan.updatedAt).toLocaleString()}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    <CompCardBody
                                        team={team}
                                        itemBuilds={itemBuilds}
                                        scoreAddon={
                                            <ScoreDelta
                                                snapshot={team.score}
                                                live={liveScores[plan.id]}
                                            />
                                        }
                                        headerRight={
                                            <>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => handleCopy(plan)}
                                                    className="h-7 gap-1.5 text-xs"
                                                    title="Copy TFT Team Planner code"
                                                >
                                                    {copiedId === plan.id ? (
                                                        <Check className="size-3.5 text-emerald-400" />
                                                    ) : (
                                                        <Copy className="size-3.5" />
                                                    )}
                                                    {copiedId === plan.id ? 'Copied' : 'Copy code'}
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => handleDelete(plan)}
                                                    disabled={deletingId === plan.id}
                                                    className="h-7 gap-1.5 text-xs text-red-400 hover:text-red-300"
                                                    title="Delete plan"
                                                >
                                                    <Trash2 className="size-3.5" />
                                                    Delete
                                                </Button>
                                            </>
                                        }
                                    />
                                </div>
                            );
                        })}
                            </div>
                        )}
                    </>
                )}
            </div>
        </>
    );
}

PlansIndex.layout = (page: React.ReactNode) => (
    <AppLayout breadcrumbs={[{ title: 'My Plans', href: '/plans' }]}>
        {page}
    </AppLayout>
);
