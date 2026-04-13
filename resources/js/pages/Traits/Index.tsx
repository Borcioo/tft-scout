import { Head } from '@inertiajs/react';
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

type TraitBreakpoint = {
    position: number;
    min_units: number;
    max_units: number | null;
    style: string | null;
    effects: Record<string, number | string>;
};

type TraitChampion = {
    api_name: string;
    name: string;
    cost: number;
};

type Trait = {
    id: number;
    api_name: string;
    name: string;
    description: string | null;
    breakpoints: TraitBreakpoint[];
    champions: TraitChampion[];
};

type Props = {
    traits: Trait[];
};

/** Style colors mirror in-game trait activation tiers. */
const STYLE_STYLES: Record<
    string,
    { border: string; bg: string; text: string }
> = {
    Bronze: {
        border: 'border-amber-700',
        bg: 'bg-amber-950/40',
        text: 'text-amber-400',
    },
    Silver: {
        border: 'border-zinc-400',
        bg: 'bg-zinc-800/60',
        text: 'text-zinc-200',
    },
    Gold: {
        border: 'border-yellow-500',
        bg: 'bg-yellow-950/40',
        text: 'text-yellow-300',
    },
    Prismatic: {
        border: 'border-fuchsia-400',
        bg: 'bg-fuchsia-950/40',
        text: 'text-fuchsia-300',
    },
    Unique: {
        border: 'border-red-500',
        bg: 'bg-red-950/40',
        text: 'text-red-300',
    },
};

const FALLBACK_STYLE = {
    border: 'border-border',
    bg: 'bg-muted',
    text: 'text-muted-foreground',
};

export default function TraitsIndex({ traits }: Props) {
    const [search, setSearch] = useState('');

    const filtered = useMemo(() => {
        if (!search.trim()) return traits;
        const q = search.toLowerCase();
        return traits.filter(
            (t) =>
                t.name.toLowerCase().includes(q) ||
                t.champions.some((c) => c.name.toLowerCase().includes(q)),
        );
    }, [traits, search]);

    return (
        <>
            <Head title="Traits — TFT Scout" />

            <div className="flex flex-col gap-6 p-6">
                <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">
                            Traits
                        </h1>
                        <p className="text-sm text-muted-foreground">
                            {traits.length} public traits in Set 17. Hover a
                            breakpoint tier to see its effects.
                        </p>
                    </div>

                    <Input
                        type="search"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search by trait or champion..."
                        className="max-w-xs"
                    />
                </div>

                {filtered.length === 0 ? (
                    <Card className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                        No traits match your search.
                    </Card>
                ) : (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
                        {filtered.map((trait) => (
                            <TraitCard key={trait.api_name} trait={trait} />
                        ))}
                    </div>
                )}
            </div>
        </>
    );
}

function TraitCard({ trait }: { trait: Trait }) {
    return (
        <Card className="flex flex-col gap-3 p-4">
            <div className="flex items-start gap-3">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40">
                    <img
                        src={`/icons/traits/${trait.api_name}.png`}
                        alt={trait.name}
                        className="size-9 object-contain"
                        loading="lazy"
                        onError={(e) => {
                            (e.target as HTMLImageElement).style.display =
                                'none';
                        }}
                    />
                </div>
                <div className="min-w-0 flex-1">
                    <h3 className="truncate text-base font-semibold">
                        {trait.name}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                        {trait.champions.length} champion
                        {trait.champions.length === 1 ? '' : 's'}
                    </p>
                </div>
            </div>

            {trait.breakpoints.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {trait.breakpoints.map((bp) => (
                        <BreakpointChip
                            key={bp.position}
                            breakpoint={bp}
                            traitName={trait.name}
                        />
                    ))}
                </div>
            )}

            {trait.champions.length > 0 && (
                <div className="flex flex-wrap gap-1">
                    {trait.champions.map((champ) => (
                        <Tooltip key={champ.api_name}>
                            <TooltipTrigger asChild>
                                <Badge
                                    variant="outline"
                                    className="gap-1 py-0.5 pl-0.5 pr-1.5 text-[11px] font-normal"
                                >
                                    <span className="inline-block size-4 overflow-hidden rounded-sm bg-muted">
                                        <img
                                            src={`/icons/champions/${champ.api_name}.png`}
                                            alt={champ.name}
                                            className="size-full object-cover"
                                            loading="lazy"
                                            onError={(e) => {
                                                (
                                                    e.target as HTMLImageElement
                                                ).style.display = 'none';
                                            }}
                                        />
                                    </span>
                                    <span>{champ.name}</span>
                                </Badge>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">
                                {champ.cost}-cost
                            </TooltipContent>
                        </Tooltip>
                    ))}
                </div>
            )}
        </Card>
    );
}

function BreakpointChip({
    breakpoint,
    traitName,
}: {
    breakpoint: TraitBreakpoint;
    traitName: string;
}) {
    const style = breakpoint.style
        ? STYLE_STYLES[breakpoint.style] ?? FALLBACK_STYLE
        : FALLBACK_STYLE;
    const label =
        breakpoint.max_units === null ||
        breakpoint.max_units === breakpoint.min_units
            ? `${breakpoint.min_units}${breakpoint.max_units === null ? '+' : ''}`
            : `${breakpoint.min_units}-${breakpoint.max_units}`;

    const effectEntries = Object.entries(breakpoint.effects);

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span
                    className={cn(
                        'inline-flex cursor-help items-center gap-1 rounded border px-2 py-0.5 text-xs font-mono',
                        style.border,
                        style.bg,
                        style.text,
                    )}
                >
                    {label}
                </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">
                <p className="mb-1 text-xs font-semibold">
                    {traitName} · {breakpoint.style ?? 'Tier'} · {label} units
                </p>
                {effectEntries.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">
                        No numeric effects
                    </p>
                ) : (
                    <ul className="space-y-0.5 text-[11px]">
                        {effectEntries.map(([key, value]) => (
                            <li key={key} className="flex justify-between gap-4">
                                <span className="text-muted-foreground">
                                    {key}
                                </span>
                                <span className="font-mono">
                                    {formatEffectValue(value)}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </TooltipContent>
        </Tooltip>
    );
}

/**
 * CDragon stores most percentage values as fractional floats (0.15 = 15%)
 * and integer stats as plain numbers (15 = 15 flat). We can't tell which is
 * which without field metadata — rule of thumb: magnitude < 1 → probably %,
 * >= 1 → flat. This misrenders a handful of fields; real fix needs per-field
 * units table (deferred).
 */
function formatEffectValue(value: number | string): string {
    if (typeof value === 'string') return value;
    if (Math.abs(value) > 0 && Math.abs(value) < 1) {
        return `${(value * 100).toFixed(0)}%`;
    }
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

TraitsIndex.layout = (page: React.ReactNode) => (
    <AppLayout
        breadcrumbs={[
            { title: 'Browse', href: '#' },
            { title: 'Traits', href: '/traits' },
        ]}
    >
        {page}
    </AppLayout>
);
