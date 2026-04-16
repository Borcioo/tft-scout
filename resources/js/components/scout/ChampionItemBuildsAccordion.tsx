import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

export type ChampionBuild = {
    items: string[];
    names: string[];
    avgPlace: number;
    games: number;
    tier: 'SS' | 'S' | 'A' | 'B' | 'C' | 'D' | null;
    frequency: number;
    placeChange: number | null;
};

export type ItemBuildsMap = Record<string, ChampionBuild[]>;

type TeamChampion = {
    apiName: string;
    baseApiName?: string | null;
    name: string;
    cost: number;
    icon: string;
};

type Props = {
    champions: TeamChampion[];
    itemBuilds: ItemBuildsMap;
};

const COST_BORDER: Record<number, string> = {
    1: 'border-zinc-500',
    2: 'border-green-500',
    3: 'border-blue-500',
    4: 'border-purple-500',
    5: 'border-yellow-500',
};

const TIER_STYLES: Record<string, string> = {
    SS: 'bg-[#ff7e83] text-zinc-900',
    S: 'bg-[#ff9f80] text-zinc-900',
    A: 'bg-[#ffbf7f] text-zinc-900',
    B: 'bg-[#ffdf80] text-zinc-900',
    C: 'bg-[#feff7f] text-zinc-900',
    D: 'bg-[#bffe7f] text-zinc-900',
};

/**
 * Collapsible per-comp item builds panel. When opened, shows top 5
 * 3-item BIS builds for every champion in the team sorted by their
 * in-game cost (carries on the right side when they're high-cost).
 *
 * Data comes prefetched in Inertia props (no fetch on expand).
 * Champions with no builds in the map are shown with a placeholder.
 *
 * Variant champions (MF conduit/challenger/replicator, Mecha Enhanced)
 * fall back to the base champion's builds via baseApiName — MetaTFT
 * publishes item stats under the base apiName.
 */
export function ChampionItemBuildsAccordion({ champions, itemBuilds }: Props) {
    const [open, setOpen] = useState(false);

    return (
        <div className="border-t pt-2">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className="flex w-full items-center justify-between text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
                <span>Item builds</span>
                <ChevronDown
                    className={cn(
                        'size-4 transition-transform',
                        open && 'rotate-180',
                    )}
                />
            </button>

            {open && (
                <div className="mt-3 flex flex-col gap-3">
                    {[...champions]
                        .sort((a, b) => b.cost - a.cost)
                        .map((champ) => (
                            <ChampionBuildsRow
                                key={champ.apiName}
                                champ={champ}
                                builds={itemBuilds[champ.baseApiName ?? champ.apiName] ?? []}
                            />
                        ))}
                </div>
            )}
        </div>
    );
}

function ChampionBuildsRow({
    champ,
    builds,
}: {
    champ: TeamChampion;
    builds: ChampionBuild[];
}) {
    return (
        <div className="flex items-start gap-3">
            <div
                className={cn(
                    'flex size-14 shrink-0 items-center justify-center overflow-hidden rounded border-2 bg-muted',
                    COST_BORDER[champ.cost] ?? 'border-zinc-500',
                )}
                title={champ.name}
            >
                <img
                    src={champ.icon}
                    alt={champ.name}
                    className="size-full object-cover"
                    loading="lazy"
                />
            </div>

            <div className="flex flex-1 flex-col gap-1">
                <div className="text-xs font-semibold text-foreground/90">
                    {champ.name}
                </div>

                {builds.length === 0 ? (
                    <div className="text-[10px] text-muted-foreground">
                        No 3-item builds with enough games yet.
                    </div>
                ) : (
                    <div className="flex flex-col gap-1">
                        {builds.map((build, i) => (
                            <div
                                key={build.items.join('|') + i}
                                className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 rounded border border-border/60 bg-muted/20 px-2 py-1 text-xs"
                            >
                                <div className="flex items-center gap-1">
                                    {build.items.map((item, j) => (
                                        <img
                                            key={item + j}
                                            src={`/icons/items/${item}.png`}
                                            alt={build.names[j] ?? item}
                                            title={build.names[j] ?? item}
                                            className="size-8 rounded border border-border/60 object-cover"
                                            onError={(e) => {
                                                (e.target as HTMLImageElement).style.display = 'none';
                                            }}
                                        />
                                    ))}
                                </div>

                                <span className="truncate text-[10px] text-muted-foreground">
                                    {build.names.join(' + ')}
                                </span>

                                {build.tier && (
                                    <span
                                        className={cn(
                                            'inline-flex h-5 min-w-7 items-center justify-center rounded px-1 text-[10px] font-bold',
                                            TIER_STYLES[build.tier] ?? '',
                                        )}
                                    >
                                        {build.tier}
                                    </span>
                                )}

                                <span className="font-mono text-[10px] text-amber-300">
                                    avg {build.avgPlace.toFixed(2)}
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
