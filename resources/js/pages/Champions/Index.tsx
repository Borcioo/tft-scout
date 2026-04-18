import { Head, Link } from '@inertiajs/react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import AppLayout from '@/layouts/app-layout';
import { cn } from '@/lib/utils';

type ChampionTrait = {
    api_name: string;
    name: string;
    category: string;
};

type Champion = {
    id: number;
    api_name: string;
    name: string;
    cost: number;
    role: string | null;
    damage_type: string | null;
    role_category: string | null;
    traits: ChampionTrait[];
};

type Props = {
    champions: Champion[];
};

/** Cost-based border colors matching TFT in-game visuals */
const COST_STYLES: Record<number, { border: string; text: string; bg: string }> = {
    1: { border: 'border-zinc-400', text: 'text-zinc-300', bg: 'from-zinc-900/60' },
    2: { border: 'border-green-500', text: 'text-green-300', bg: 'from-green-900/60' },
    3: { border: 'border-blue-500', text: 'text-blue-300', bg: 'from-blue-900/60' },
    4: { border: 'border-purple-500', text: 'text-purple-300', bg: 'from-purple-900/60' },
    5: { border: 'border-yellow-500', text: 'text-yellow-300', bg: 'from-yellow-900/60' },
};

export default function ChampionsIndex({ champions }: Props) {
    const [search, setSearch] = useState('');
    const [costFilter, setCostFilter] = useState<number | null>(null);

    const filtered = useMemo(() => {
        let list = champions;

        if (search.trim()) {
            const q = search.toLowerCase();
            list = list.filter(
                (c) =>
                    c.name.toLowerCase().includes(q) ||
                    c.traits.some((t) => t.name.toLowerCase().includes(q)),
            );
        }

        if (costFilter !== null) {
            list = list.filter((c) => c.cost === costFilter);
        }

        return list;
    }, [champions, search, costFilter]);

    const grouped = useMemo(() => {
        const groups: Record<number, Champion[]> = { 1: [], 2: [], 3: [], 4: [], 5: [] };

        for (const champ of filtered) {
            const cost = Math.min(Math.max(champ.cost, 1), 5);
            groups[cost].push(champ);
        }

        return groups;
    }, [filtered]);

    const costs = [1, 2, 3, 4, 5] as const;

    return (
        <>
            <Head title="Champions — TFT Scout" />

            <div className="flex flex-col gap-6 p-6">
                {/* Sticky header + filter bar — stays visible while the
                    champion grid below scrolls. `-m-6 p-6 -mb-0 pb-6`
                    keeps the backdrop flush with the page padding so
                    content scrolling under it is properly masked. */}
                <div className="sticky top-0 z-20 -mx-6 -mt-6 flex flex-col gap-3 bg-background/95 px-6 pb-3 pt-6 backdrop-blur supports-[backdrop-filter]:bg-background/75">
                    <div className="flex flex-wrap items-end justify-between gap-3">
                        <div>
                            <h1 className="text-2xl font-bold tracking-tight">
                                Champions
                            </h1>
                            <p className="text-sm text-muted-foreground">
                                {champions.length} champions in Set 17. Click a cost
                                to filter.
                            </p>
                        </div>

                        <Input
                            type="search"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search by name or trait..."
                            className="max-w-xs"
                        />
                    </div>

                    <div className="flex flex-wrap gap-2">
                        <CostTab
                            active={costFilter === null}
                            onClick={() => setCostFilter(null)}
                            label="All"
                        />
                        {costs.map((cost) => (
                            <CostTab
                                key={cost}
                                active={costFilter === cost}
                                onClick={() =>
                                    setCostFilter(costFilter === cost ? null : cost)
                                }
                                label={`${cost} cost`}
                                colorClass={COST_STYLES[cost].text}
                            />
                        ))}
                    </div>
                </div>

                {/* Results */}
                {filtered.length === 0 ? (
                    <Card className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                        No champions match your filters.
                    </Card>
                ) : (
                    <div className="flex flex-col gap-6">
                        {costs.map((cost) => {
                            const champs = grouped[cost];

                            if (champs.length === 0) {
return null;
}

                            return (
                                <section
                                    key={cost}
                                    className="flex flex-col gap-3"
                                >
                                    <div className="flex items-center gap-3">
                                        <Badge
                                            className={cn(
                                                'font-mono text-[10px]',
                                                COST_STYLES[cost].text,
                                            )}
                                            variant="outline"
                                        >
                                            {cost} cost · {champs.length}
                                        </Badge>
                                        <div className="h-px flex-1 bg-border" />
                                    </div>
                                    <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
                                        {champs.map((champ) => (
                                            <Link
                                                key={champ.api_name}
                                                href={`/champions/${champ.api_name}`}
                                                prefetch
                                            >
                                                <ChampionCard
                                                    champion={champ}
                                                />
                                            </Link>
                                        ))}
                                    </div>
                                </section>
                            );
                        })}
                    </div>
                )}
            </div>
        </>
    );
}

function CostTab({
    active,
    onClick,
    label,
    colorClass,
}: {
    active: boolean;
    onClick: () => void;
    label: string;
    colorClass?: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'rounded-md border px-3 py-1 text-xs font-medium transition-colors',
                active
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border bg-background hover:border-foreground/40',
                colorClass && !active && colorClass,
            )}
        >
            {label}
        </button>
    );
}

function ChampionCard({ champion }: { champion: Champion }) {
    const style = COST_STYLES[Math.min(Math.max(champion.cost, 1), 5)];
    // Hidden traits (HPTank, ResistTank, MetaTFT grouping traits) aren't
    // meant to be shown in UI — they exist only for ratings/algorithm logic.
    const visibleTraits = champion.traits.filter(
        (t) => t.category !== 'hidden',
    );

    return (
        <Card
            className={cn(
                'group relative flex cursor-pointer flex-col gap-0 overflow-hidden border-2 p-0 transition-all hover:shadow-lg',
                style.border,
            )}
        >
            <div className="relative aspect-square overflow-hidden">
                <div
                    className={cn(
                        'absolute inset-0 z-10 bg-gradient-to-t to-transparent',
                        style.bg,
                    )}
                />
                <img
                    src={`/icons/champions/${champion.api_name}.png`}
                    alt={champion.name}
                    className="size-full object-cover transition-transform duration-300 ease-out group-hover:scale-110"
                    loading="lazy"
                    onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                    }}
                />
            </div>
            <div className="flex flex-col gap-2 p-3">
                <p className="truncate text-sm font-semibold">
                    {champion.name}
                </p>
                {visibleTraits.length > 0 ? (
                    <div className="flex items-center gap-1.5">
                        {visibleTraits.map((trait) => (
                            <Tooltip key={trait.api_name}>
                                <TooltipTrigger asChild>
                                    <img
                                        src={`/icons/traits/${trait.api_name}.png`}
                                        alt={trait.name}
                                        className="size-6 opacity-80 transition-opacity hover:opacity-100"
                                        loading="lazy"
                                        onError={(e) => {
                                            (
                                                e.target as HTMLImageElement
                                            ).style.display = 'none';
                                        }}
                                    />
                                </TooltipTrigger>
                                <TooltipContent
                                    side="top"
                                    className="text-xs"
                                >
                                    {trait.name}
                                </TooltipContent>
                            </Tooltip>
                        ))}
                    </div>
                ) : (
                    <p className="text-xs text-muted-foreground">—</p>
                )}
            </div>
        </Card>
    );
}

ChampionsIndex.layout = (page: React.ReactNode) => (
    <AppLayout
        breadcrumbs={[
            { title: 'Browse', href: '#' },
            { title: 'Champions', href: '/champions' },
        ]}
    >
        {page}
    </AppLayout>
);
