import { Hand, Shield, Sparkles, Swords } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { STYLE_RANK, titleTraits } from '@/workers/scout/slate';
import type { ScoredTeam } from '@/workers/scout/types';
import type { ItemBuildsMap } from './ChampionItemBuildsAccordion';
import { ChampionItemBuildsAccordion } from './ChampionItemBuildsAccordion';
import { ChampionVariantBadge } from './ChampionVariantBadge';
import { WhyThisComp } from './WhyThisComp';

const COST_BORDER: Record<number, string> = {
    1: 'border-zinc-500',
    2: 'border-green-500',
    3: 'border-blue-500',
    4: 'border-purple-500',
    5: 'border-yellow-500',
};

const STYLE_CHIP: Record<string, string> = {
    Bronze: 'border-amber-700 bg-amber-950/40 text-amber-400',
    Silver: 'border-zinc-400 bg-zinc-800/60 text-zinc-200',
    Gold: 'border-yellow-500 bg-yellow-950/40 text-yellow-300',
    Prismatic: 'border-fuchsia-400 bg-fuchsia-950/40 text-fuchsia-300',
    Unique: 'border-red-500 bg-red-950/40 text-red-300',
};

type Props = {
    team: ScoredTeam;
    itemBuilds: ItemBuildsMap;
    /** Slot at the top-right (Score + buttons in Scout, title/actions in Plans). */
    headerRight?: ReactNode;
    /** Optional override for the left title (e.g. plan name on Plans page). */
    headerLeft?: ReactNode;
    /** Rendered right after the Score number — used on Plans page for
     *  a live-vs-snapshot delta indicator. */
    scoreAddon?: ReactNode;
};

/**
 * Pure presentation layer shared between Scout results and saved Plans.
 * Renders title traits / score / role icons / champion row / trait badges /
 * insights / item builds accordion. Action buttons are injected via
 * `headerRight` so each context owns its own behavior.
 */
const pct = (x: number | undefined) => `${Math.round((x ?? 0) * 100)}%`;

export function CompCardBody({
    team,
    itemBuilds,
    headerRight,
    headerLeft,
    scoreAddon,
}: Props) {
    const rerollOf = new Map(
        (team.reroll ?? []).map((r) => [r.apiName, r.hitChance]),
    );
    const title = titleTraits(team.activeTraits, (t) => t.style);

    return (
        <Card className="flex flex-col gap-3 p-4">
            <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    {headerLeft ??
                        title.map((t, i) => (
                            <span
                                key={t.apiName}
                                className="flex items-center gap-1 font-semibold text-sm"
                            >
                                {t.icon && (
                                    <img
                                        src={t.icon}
                                        alt=""
                                        className="size-4"
                                    />
                                )}
                                <span className="truncate">
                                    {t.count} {t.name}
                                </span>
                                {i < title.length - 1 && (
                                    <span className="text-muted-foreground">
                                        +
                                    </span>
                                )}
                            </span>
                        ))}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                    {team.metaMatch && (
                        <Badge
                            variant="outline"
                            className="gap-1 border-emerald-500/60 bg-emerald-950/40 text-emerald-300"
                            title={`Matches ${team.metaMatch.overlap}/${team.metaMatch.total} units of "${team.metaMatch.name}" meta comp (${team.metaMatch.games.toLocaleString()} games)`}
                        >
                            <Sparkles className="size-3" />
                            Meta · avg {team.metaMatch.avgPlace.toFixed(2)}
                        </Badge>
                    )}
                    {team.breakdown?.avgPlace != null && (
                        <span
                            className="font-mono text-muted-foreground text-sm"
                            title={
                                team.breakdown.beyondData
                                    ? 'Rated above every board people played, so the estimate stops at the best real average; the score still ranks these boards'
                                    : 'Estimated average placement (1–8) of players who end the game with this board — from MetaTFT unit, pair and trait stats, calibrated on ~4k boards people played'
                            }
                        >
                            {team.breakdown.beyondData ? '≤' : '~'}
                            {team.breakdown.avgPlace.toFixed(2)} avg
                        </span>
                    )}
                    <span className="flex items-center gap-1.5 font-mono text-muted-foreground text-sm">
                        Score{' '}
                        <span className="font-bold text-amber-300 text-lg">
                            {team.score.toFixed(1)}
                        </span>
                        {scoreAddon}
                    </span>
                    {headerRight}
                </div>
            </div>

            {team.roles && (
                <div className="flex items-center gap-3 font-mono text-muted-foreground text-xs">
                    <span className="flex items-center gap-1 text-blue-400">
                        <Shield className="size-3.5" aria-label="Frontline" />
                        {team.roles.frontline}
                    </span>
                    <span className="flex items-center gap-1 text-red-400">
                        <Swords className="size-3.5" aria-label="DPS" />
                        {team.roles.dps}
                    </span>
                    {team.roles.fighter > 0 && (
                        <span className="flex items-center gap-1 text-yellow-400">
                            <Hand className="size-3.5" aria-label="Fighter" />
                            {team.roles.fighter}
                        </span>
                    )}
                </div>
            )}

            <div className="flex flex-wrap gap-1.5">
                {[...team.champions]
                    .sort((a, b) => a.cost - b.cost)
                    .map((c) => (
                        <div
                            key={c.apiName}
                            className={cn(
                                'relative flex size-12 items-center justify-center overflow-hidden rounded border-2 bg-muted',
                                COST_BORDER[c.cost] ?? 'border-zinc-500',
                            )}
                            title={
                                rerollOf.has(c.apiName)
                                    ? `${c.name} — reroll to 3★ (${pct(rerollOf.get(c.apiName))} hit)`
                                    : c.name
                            }
                        >
                            {rerollOf.has(c.apiName) && (
                                <span className="absolute inset-x-0 top-0 z-10 bg-black/70 text-center text-[9px] text-amber-300 leading-3">
                                    ★★★
                                </span>
                            )}
                            {c.icon ? (
                                <img
                                    src={c.icon}
                                    alt={c.name}
                                    className="size-full object-cover"
                                    loading="lazy"
                                />
                            ) : (
                                <span className="text-[10px]">
                                    {c.name.slice(0, 3)}
                                </span>
                            )}
                            <ChampionVariantBadge
                                variant={(c as any).variant}
                                size="md"
                            />
                        </div>
                    ))}
            </div>

            {rerollOf.size > 0 && (
                <p
                    className="font-mono text-amber-300/90 text-xs"
                    title="Reroll plan: roll these units to 3★. Hit chance = how often players carrying the unit with 3 items had it at 3★ (MetaTFT); the board is rated at that expected result"
                >
                    Reroll to 3★:{' '}
                    {(team.reroll ?? [])
                        .map(
                            (r) =>
                                `${team.champions.find((c) => c.apiName === r.apiName)?.name ?? r.apiName} (${pct(r.hitChance)} hit)`,
                        )
                        .join(' · ')}
                </p>
            )}

            <div className="flex flex-wrap gap-1">
                {[...team.activeTraits]
                    .sort((a, b) => {
                        const sa = STYLE_RANK[a.style ?? 'Bronze'] ?? 0;
                        const sb = STYLE_RANK[b.style ?? 'Bronze'] ?? 0;
                        return sb !== sa ? sb - sa : b.count - a.count;
                    })
                    .map((t) => {
                        const style = t.style ?? 'Bronze';
                        return (
                            <Badge
                                key={t.apiName}
                                variant="outline"
                                className={cn(
                                    'gap-1 text-[10px]',
                                    STYLE_CHIP[style] ?? '',
                                )}
                            >
                                {t.icon && (
                                    <img
                                        src={t.icon}
                                        alt=""
                                        className="size-3"
                                    />
                                )}
                                {t.count} {t.name}
                            </Badge>
                        );
                    })}
            </div>

            <WhyThisComp insights={team.insights} />

            <ChampionItemBuildsAccordion
                champions={team.champions as any}
                itemBuilds={itemBuilds}
            />
        </Card>
    );
}

/** Build a readable default name from the strongest 1-2 traits. */
export function buildPlanName(team: ScoredTeam): string {
    const top = titleTraits(team.activeTraits, (t) => t.style)
        .map((t) => `${t.count} ${t.name}`)
        .join(' + ');
    return top || 'Untitled comp';
}
