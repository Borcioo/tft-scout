import type { ReactNode } from 'react';
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from '@/components/ui/accordion';
import type { InsightItem, TeamInsights } from '@/workers/scout/types';

type Props = {
    insights: TeamInsights | null;
};

/**
 * Player-facing "Why this comp?" panel. Renders a Shadcn accordion
 * with two sections — Strengths and Concerns — populated from the
 * structured InsightItem list produced by the worker.
 *
 * The discriminated-union switch in renderInsight() means every new
 * InsightItem kind breaks the build until a render case is added.
 * Deliberate — keeps the UI in sync with the worker rule set.
 */
export function WhyThisComp({ insights }: Props) {
    const strengths = insights?.strengths ?? [];
    const concerns = insights?.concerns ?? [];
    const empty = strengths.length === 0 && concerns.length === 0;

    return (
        <Accordion type="single" collapsible className="w-full">
            <AccordionItem value="why" className="border-0">
                <AccordionTrigger
                    className="py-2 text-sm"
                    disabled={empty}
                >
                    {empty ? 'No insights for this comp' : 'Why this comp?'}
                </AccordionTrigger>
                <AccordionContent>
                    <div className="flex flex-col gap-4 pt-2 text-sm">
                        {strengths.length > 0 && (
                            <section>
                                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-emerald-400">
                                    💪 Strengths
                                </h4>
                                <ul className="flex flex-col gap-1 text-muted-foreground">
                                    {strengths.map((item, i) => (
                                        <li key={i} className="leading-snug">
                                            {renderInsight(item)}
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}
                        {concerns.length > 0 && (
                            <section>
                                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wider text-amber-400">
                                    ⚠️ Concerns
                                </h4>
                                <ul className="flex flex-col gap-1 text-muted-foreground">
                                    {concerns.map((item, i) => (
                                        <li key={i} className="leading-snug">
                                            {renderInsight(item)}
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}
                    </div>
                </AccordionContent>
            </AccordionItem>
        </Accordion>
    );
}

function renderInsight(item: InsightItem): ReactNode {
    switch (item.kind) {
        case 'metaMatch':
            return (
                <>
                    Matches meta comp <strong>{item.compName}</strong> ({fmtAvg(item.avgPlace)} avg, {fmtGames(item.games)} games)
                </>
            );
        case 'topCarry':
            return (
                <>
                    <ChampIcon api={item.championApiName} />{' '}
                    <strong>{item.displayName}</strong> is a top carry this patch ({fmtAvg(item.avgPlace)} avg, {fmtGames(item.games)} games)
                </>
            );
        case 'strongTrait':
            return (
                <>
                    <TraitIcon api={item.traitApiName} />{' '}
                    <strong>{item.displayName} {item.count}</strong> is a strong trait ({fmtAvg(item.avgPlace)} avg across {fmtGames(item.games)} games)
                </>
            );
        case 'affinityHit':
            return (
                <>
                    <ChampIcon api={item.championApiName} />{' '}
                    <strong>{item.championName}</strong> performs best in{' '}
                    <TraitIcon api={item.traitApiName} /> <strong>{item.traitName}</strong> ({fmtAvg(item.avgPlace)} avg)
                </>
            );
        case 'provenPair':
            return (
                <>
                    <ChampIcon api={item.aApi} />{' '}
                    <strong>{item.aName} + {item.bName}</strong>{' '}
                    <ChampIcon api={item.bApi} /> — proven duo ({fmtAvg(item.avgPlace)} avg when together)
                </>
            );
        case 'highBreakpoint':
            return (
                <>
                    <TraitIcon api={item.traitApiName} />{' '}
                    <strong>{item.displayName} {item.count}</strong> — peak breakpoint, consistently top 4
                </>
            );
        case 'weakChampion':
            return (
                <>
                    <ChampIcon api={item.championApiName} />{' '}
                    <strong>{item.championName}</strong> struggles this patch ({fmtAvg(item.avgPlace)} avg) — held for {item.reasonTraitName} count
                </>
            );
        case 'lowBreakpoint':
            return (
                <>
                    <TraitIcon api={item.traitApiName} />{' '}
                    <strong>{item.displayName} {item.count}</strong> — weakest breakpoint, low impact
                </>
            );
        case 'unprovenTrait':
            return (
                <>
                    <TraitIcon api={item.traitApiName} />{' '}
                    <strong>{item.displayName}</strong> — too few games to know if it works ({fmtGames(item.games)})
                </>
            );
        case 'singleCore':
            return (
                <>
                    Comp leans on <TraitIcon api={item.traitApiName} />{' '}
                    <strong>{item.displayName}</strong> alone — no backup synergy
                </>
            );
        case 'noMetaMatch':
            return <>Experimental build — no matching meta comp on MetaTFT</>;
        case 'staleData':
            return <>MetaTFT data is over 24h old — numbers may be outdated</>;
    }
}

function ChampIcon({ api }: { api: string }) {
    return (
        <img
            src={`/icons/champions/${api}.png`}
            alt=""
            className="inline-block size-4 align-middle"
            loading="lazy"
        />
    );
}

function TraitIcon({ api }: { api: string }) {
    return (
        <img
            src={`/icons/traits/${api}.png`}
            alt=""
            className="inline-block size-4 align-middle"
            loading="lazy"
        />
    );
}

function fmtAvg(n: number): string {
    return n.toFixed(2);
}

function fmtGames(n: number): string {
    return n.toLocaleString('en-US');
}
