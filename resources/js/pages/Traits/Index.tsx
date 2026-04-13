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
    rendered: string | null;
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
    category: 'public' | 'unique';
    /** Base description with placeholders already resolved by TraitDescriptionResolver */
    description: string | null;
    description_raw: string | null;
    breakpoints: TraitBreakpoint[];
    champions: TraitChampion[];
};

type Props = {
    public_traits: Trait[];
    unique_traits: Trait[];
};

const STYLE_STYLES: Record<
    string,
    { border: string; bg: string; text: string }
> = {
    Bronze: { border: 'border-amber-700', bg: 'bg-amber-950/40', text: 'text-amber-400' },
    Silver: { border: 'border-zinc-400', bg: 'bg-zinc-800/60', text: 'text-zinc-200' },
    Gold: { border: 'border-yellow-500', bg: 'bg-yellow-950/40', text: 'text-yellow-300' },
    Prismatic: { border: 'border-fuchsia-400', bg: 'bg-fuchsia-950/40', text: 'text-fuchsia-300' },
    Unique: { border: 'border-red-500', bg: 'bg-red-950/40', text: 'text-red-300' },
};

const FALLBACK_STYLE = {
    border: 'border-border',
    bg: 'bg-muted',
    text: 'text-muted-foreground',
};

const TAG_CLASSES: Record<string, string> = {
    physicalDamage: 'font-semibold text-orange-400',
    magicDamage: 'font-semibold text-sky-400',
    trueDamage: 'font-semibold text-white',
    scaleHealth: 'font-semibold text-emerald-400',
    scaleAD: 'font-semibold text-orange-400',
    scaleAP: 'font-semibold text-sky-400',
    scaleArmor: 'font-semibold text-yellow-400',
    scaleMR: 'font-semibold text-purple-400',
    scaleLevel: 'font-semibold text-cyan-300',
    TFTBonus: 'font-semibold text-amber-400',
    TFTKeyword: 'font-semibold text-amber-300',
    spellActive: 'font-semibold text-fuchsia-400',
    spellPassive: 'font-semibold text-blue-300',
    tftActive: 'font-semibold text-fuchsia-400',
    tftPassive: 'font-semibold text-blue-300',
    status: 'font-semibold text-amber-300',
    rules: 'text-xs italic text-muted-foreground',
    TFTGuildInactive: 'text-muted-foreground italic',
};

const SCALE_ICON_LABELS: Record<string, string> = {
    scaleAD: 'AD',
    scaleAP: 'AP',
    scaleArmor: 'AR',
    scaleMR: 'MR',
    scaleHealth: 'HP',
    scaleMana: 'Mana',
    scaleAS: 'AS',
    TFTManaRegen: 'MP/s',
    scaleHPRegen: 'HP/s',
};

/**
 * Render a pre-resolved trait description. Placeholders are substituted
 * server-side (TraitDescriptionResolver), so this only handles tooltip
 * tags, `%i:scaleX%` icon markers, and `<br>` line breaks. Returns flat
 * React nodes for drop-in placement.
 */
function renderDescription(text: string | null | undefined): React.ReactNode[] {
    if (!text) return [];

    let normalised = text.replace(/<br\s*\/?>/gi, '\n');
    normalised = normalised.replace(/&nbsp;/g, ' ');
    normalised = normalised.replace(/(?:%i:\w+%)+/g, (match) => {
        const parts = match.match(/%i:(\w+)%/g) || [];
        return parts
            .map((p) => {
                const name = p.replace(/%i:|%/g, '');
                return SCALE_ICON_LABELS[name] ?? name.replace(/^scale/, '');
            })
            .join('+');
    });

    return tokenize(normalised);
}

function tokenize(text: string): React.ReactNode[] {
    const nodes: React.ReactNode[] = [];
    const tagRegex = /<(\/?)([A-Za-z_][A-Za-z0-9_]*)(?:\s[^>]*)?>/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let keyCounter = 0;

    while ((match = tagRegex.exec(text)) !== null) {
        const [full, closingSlash, tagName] = match;
        const start = match.index;

        if (closingSlash) {
            if (start > lastIndex) nodes.push(text.slice(lastIndex, start));
            lastIndex = start + full.length;
            continue;
        }

        const closeTag = `</${tagName}>`;
        const closeIdx = findMatchingClose(text, tagRegex.lastIndex, tagName);

        if (closeIdx === -1) {
            if (start > lastIndex) nodes.push(text.slice(lastIndex, start));
            nodes.push(full);
            lastIndex = start + full.length;
            continue;
        }

        if (start > lastIndex) nodes.push(text.slice(lastIndex, start));

        const innerText = text.slice(start + full.length, closeIdx);
        const innerNodes = tokenize(innerText);
        const className = TAG_CLASSES[tagName];

        nodes.push(
            <span key={`tag-${keyCounter++}`} className={className}>
                {innerNodes}
            </span>,
        );

        lastIndex = closeIdx + closeTag.length;
        tagRegex.lastIndex = lastIndex;
    }

    if (lastIndex < text.length) nodes.push(text.slice(lastIndex));

    return nodes.flatMap((node, i) => {
        if (typeof node !== 'string') return [node];
        const parts = node.split('\n');
        const out: React.ReactNode[] = [];
        parts.forEach((part, pi) => {
            if (pi > 0) out.push(<br key={`br-${i}-${pi}`} />);
            if (part) out.push(part);
        });
        return out;
    });
}

/**
 * Scan forward to find the matching closing tag at the same nesting depth.
 * Nested same-name tags (`<TFTBonus>...<TFTBonus>...</TFTBonus>...</TFTBonus>`)
 * stay consistent; unmatched opens return -1 so the caller emits literal text.
 */
function findMatchingClose(
    text: string,
    fromIndex: number,
    tagName: string,
): number {
    const opens = new RegExp(`<${tagName}(?:\\s[^>]*)?>`, 'g');
    const closes = new RegExp(`</${tagName}>`, 'g');

    let depth = 1;
    let cursor = fromIndex;

    while (cursor < text.length) {
        opens.lastIndex = cursor;
        closes.lastIndex = cursor;
        const openMatch = opens.exec(text);
        const closeMatch = closes.exec(text);

        if (!closeMatch) return -1;

        if (openMatch && openMatch.index < closeMatch.index) {
            depth++;
            cursor = openMatch.index + openMatch[0].length;
            continue;
        }

        depth--;
        if (depth === 0) return closeMatch.index;
        cursor = closeMatch.index + closeMatch[0].length;
    }

    return -1;
}

export default function TraitsIndex({ public_traits, unique_traits }: Props) {
    const [search, setSearch] = useState('');

    const filterFn = (t: Trait) => {
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        return (
            t.name.toLowerCase().includes(q) ||
            t.champions.some((c) => c.name.toLowerCase().includes(q))
        );
    };

    const filteredPublic = useMemo(
        () => public_traits.filter(filterFn),
        [public_traits, search],
    );
    const filteredUnique = useMemo(
        () => unique_traits.filter(filterFn),
        [unique_traits, search],
    );

    const totalCount = filteredPublic.length + filteredUnique.length;

    return (
        <>
            <Head title="Traits — TFT Scout" />

            <div className="flex flex-col gap-8 p-6">
                <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">Traits</h1>
                        <p className="text-sm text-muted-foreground">
                            {public_traits.length} origins &amp; classes,{' '}
                            {unique_traits.length} unique traits in Set 17.
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

                {totalCount === 0 ? (
                    <Card className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                        No traits match your search.
                    </Card>
                ) : (
                    <>
                        {filteredPublic.length > 0 && (
                            <TraitSection
                                title="Origins & Classes"
                                subtitle="Shared team traits with tier breakpoints"
                                traits={filteredPublic}
                            />
                        )}
                        {filteredUnique.length > 0 && (
                            <TraitSection
                                title="Unique Traits"
                                subtitle="Per-champion signature traits — always active on the owning champion"
                                traits={filteredUnique}
                            />
                        )}
                    </>
                )}
            </div>
        </>
    );
}

function TraitSection({
    title,
    subtitle,
    traits,
}: {
    title: string;
    subtitle: string;
    traits: Trait[];
}) {
    return (
        <section className="flex flex-col gap-4">
            <div className="flex items-baseline justify-between gap-3 border-b border-border/60 pb-2">
                <div>
                    <h2 className="text-lg font-semibold tracking-tight">
                        {title}
                    </h2>
                    <p className="text-xs text-muted-foreground">{subtitle}</p>
                </div>
                <span className="text-xs font-mono text-muted-foreground">
                    {traits.length}
                </span>
            </div>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
                {traits.map((trait) => (
                    <TraitCard key={trait.api_name} trait={trait} />
                ))}
            </div>
        </section>
    );
}

function TraitCard({ trait }: { trait: Trait }) {
    const descriptionNodes = useMemo(
        () => renderDescription(trait.description),
        [trait.description],
    );

    const isUnique = trait.category === 'unique';

    return (
        <Card
            className={cn(
                'flex flex-col gap-4 p-5',
                isUnique && 'border-red-900/50 bg-red-950/10',
            )}
        >
            <div className="flex items-start gap-4">
                <div
                    className={cn(
                        'flex size-16 shrink-0 items-center justify-center rounded-lg border bg-muted/40',
                        isUnique ? 'border-red-800/60' : 'border-border',
                    )}
                >
                    <img
                        src={`/icons/traits/${trait.api_name}.png`}
                        alt={trait.name}
                        className="size-12 object-contain"
                        loading="lazy"
                        onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                        }}
                    />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <h3 className="truncate text-lg font-bold tracking-tight">
                            {trait.name}
                        </h3>
                        {isUnique && (
                            <Badge
                                variant="outline"
                                className="border-red-700/60 bg-red-950/40 px-1.5 py-0 text-[10px] uppercase tracking-wider text-red-300"
                            >
                                Unique
                            </Badge>
                        )}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                        {trait.champions.length} champion
                        {trait.champions.length === 1 ? '' : 's'}
                        {trait.breakpoints.length > 0 && (
                            <>
                                {' · '}
                                {trait.breakpoints.length} tier
                                {trait.breakpoints.length === 1 ? '' : 's'}
                            </>
                        )}
                    </p>
                </div>
            </div>

            {descriptionNodes.length > 0 && (
                <p className="text-sm leading-relaxed text-foreground/90">
                    {descriptionNodes}
                </p>
            )}

            {trait.breakpoints.length > 0 && !isUnique && (
                <div className="flex flex-col gap-2 border-t border-border/50 pt-3">
                    {trait.breakpoints.map((bp) => (
                        <BreakpointRow
                            key={bp.position}
                            breakpoint={bp}
                            traitName={trait.name}
                        />
                    ))}
                </div>
            )}

            {trait.champions.length > 0 && (
                <div className="flex flex-wrap gap-1.5 border-t border-border/50 pt-3">
                    {trait.champions.map((champ) => (
                        <Tooltip key={champ.api_name}>
                            <TooltipTrigger asChild>
                                <Badge
                                    variant="outline"
                                    className="gap-1.5 py-0.5 pl-0.5 pr-2 text-xs font-normal"
                                >
                                    <span className="inline-block size-5 overflow-hidden rounded-sm bg-muted">
                                        <img
                                            src={`/icons/champions/${champ.api_name}.png`}
                                            alt={champ.name}
                                            className="size-full object-cover"
                                            loading="lazy"
                                            onError={(e) => {
                                                (e.target as HTMLImageElement).style.display = 'none';
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

function BreakpointRow({
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

    const renderedNodes = useMemo(
        () => renderDescription(breakpoint.rendered),
        [breakpoint.rendered],
    );

    return (
        <div className="flex items-start gap-3">
            <span
                className={cn(
                    'mt-0.5 inline-flex h-6 min-w-[2.5rem] shrink-0 items-center justify-center rounded border px-2 font-mono text-xs font-semibold',
                    style.border,
                    style.bg,
                    style.text,
                )}
            >
                {label}
            </span>
            {renderedNodes.length > 0 ? (
                <p className="text-sm leading-snug text-foreground/85">
                    {renderedNodes}
                </p>
            ) : (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span className="cursor-help text-xs italic text-muted-foreground">
                            No description
                        </span>
                    </TooltipTrigger>
                    <TooltipContent>
                        <p className="text-xs">
                            {traitName} · {breakpoint.style ?? 'Tier'}
                        </p>
                    </TooltipContent>
                </Tooltip>
            )}
        </div>
    );
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
