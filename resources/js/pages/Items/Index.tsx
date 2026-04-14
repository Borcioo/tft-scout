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

type ItemComponent = {
    api_name: string;
    name: string;
};

type EmblemTrait = {
    api_name: string;
    name: string;
};

type Item = {
    id: number | string;
    api_name: string;
    name: string;
    /** Rendered description — placeholders pre-substituted server-side */
    description: string | null;
    type: string;
    tier: string | null;
    effects: Record<string, number | string>;
    tags: string[];
    component_1: ItemComponent | null;
    component_2: ItemComponent | null;
    /** Set on emblem-type items — links back to the trait the emblem grants */
    trait: EmblemTrait | null;
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
    TFTBonus: 'font-semibold text-amber-400',
    TFTKeyword: 'font-semibold text-amber-300',
    TFTRadiantItemBonus: 'font-semibold text-yellow-200',
    status: 'font-semibold text-amber-300',
    rules: 'text-xs italic text-muted-foreground',
    tftitemrules: 'text-[11px] italic text-muted-foreground',
};

const SCALE_ICON_LABELS: Record<string, string> = {
    scaleAD: 'AD',
    scaleAP: 'AP',
    scaleArmor: 'AR',
    scaleMR: 'MR',
    scaleHealth: 'HP',
    scaleMana: 'Mana',
    scaleAS: 'AS',
};

/**
 * Render a pre-resolved item description. Placeholders are substituted
 * server-side (ItemDescriptionResolver); this just walks the tag tree,
 * applies tooltip color classes, maps `%i:scaleX%` to short labels, and
 * turns `<br>` into newline breaks.
 */
function renderDescription(text: string | null | undefined): React.ReactNode[] {
    if (!text) {
return [];
}

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
            if (start > lastIndex) {
nodes.push(text.slice(lastIndex, start));
}

            lastIndex = start + full.length;
            continue;
        }

        const closeTag = `</${tagName}>`;
        const closeIdx = findMatchingClose(text, tagRegex.lastIndex, tagName);

        if (closeIdx === -1) {
            if (start > lastIndex) {
nodes.push(text.slice(lastIndex, start));
}

            nodes.push(full);
            lastIndex = start + full.length;
            continue;
        }

        if (start > lastIndex) {
nodes.push(text.slice(lastIndex, start));
}

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

    if (lastIndex < text.length) {
nodes.push(text.slice(lastIndex));
}

    return nodes.flatMap((node, i) => {
        if (typeof node !== 'string') {
return [node];
}

        const parts = node.split('\n');
        const out: React.ReactNode[] = [];
        parts.forEach((part, pi) => {
            if (pi > 0) {
out.push(<br key={`br-${i}-${pi}`} />);
}

            if (part) {
out.push(part);
}
        });

        return out;
    });
}

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

        if (!closeMatch) {
return -1;
}

        if (openMatch && openMatch.index < closeMatch.index) {
            depth++;
            cursor = openMatch.index + openMatch[0].length;
            continue;
        }

        depth--;

        if (depth === 0) {
return closeMatch.index;
}

        cursor = closeMatch.index + closeMatch[0].length;
    }

    return -1;
}

type Props = {
    items: Item[];
};

const TYPE_ORDER = [
    'craftable',
    'base',
    'radiant',
    'artifact',
    'support',
    'trait_item',
    'emblem',
] as const;

const TYPE_STYLES: Record<
    string,
    { label: string; accent: string; border: string }
> = {
    craftable: {
        label: 'Craftable',
        accent: 'text-sky-300',
        border: 'border-sky-600/50',
    },
    base: {
        label: 'Base',
        accent: 'text-zinc-200',
        border: 'border-zinc-500/50',
    },
    radiant: {
        label: 'Radiant',
        accent: 'text-yellow-300',
        border: 'border-yellow-500/60',
    },
    artifact: {
        label: 'Artifact',
        accent: 'text-fuchsia-300',
        border: 'border-fuchsia-500/50',
    },
    support: {
        label: 'Support',
        accent: 'text-emerald-300',
        border: 'border-emerald-500/50',
    },
    trait_item: {
        label: 'Trait Item',
        accent: 'text-pink-300',
        border: 'border-pink-500/50',
    },
    emblem: {
        label: 'Emblem',
        accent: 'text-rose-300',
        border: 'border-rose-500/50',
    },
};

/**
 * Core item stats Riot ships with most completed items. Order matters
 * for display — we render in this sequence so Health always shows
 * before AP, AD before AS, etc., regardless of effects-dict iteration
 * order. Each entry maps the raw CDragon key to a short label and the
 * format hint (`pctFlat` = stored as percent fraction like 0.15 → 15%,
 * `pct` = stored as int already representing a percent like 35 → 35%,
 * `flat` = render as-is). Anything outside this list is left out of the
 * stats row and shown via the description text instead.
 */
const CORE_STATS: { key: string; label: string; format: 'flat' | 'pct' | 'pctFlat' }[] = [
    { key: 'Health', label: 'HP', format: 'flat' },
    { key: 'AD', label: 'AD', format: 'pctFlat' },
    { key: 'AP', label: 'AP', format: 'flat' },
    { key: 'AS', label: 'AS', format: 'pct' },
    { key: 'Armor', label: 'Armor', format: 'flat' },
    { key: 'MagicResist', label: 'MR', format: 'flat' },
    { key: 'ManaRegen', label: 'MP/s', format: 'flat' },
    { key: 'Mana', label: 'Mana', format: 'flat' },
    { key: 'CritChance', label: 'Crit', format: 'pct' },
    { key: 'Omnivamp', label: 'Omni', format: 'pct' },
    { key: 'StatOmnivamp', label: 'Omni', format: 'pctFlat' },
];

function formatCoreStat(value: number, format: 'flat' | 'pct' | 'pctFlat'): string {
    if (format === 'pctFlat') {
return `${Math.round(value * 100)}%`;
}

    if (format === 'pct') {
return `${Math.round(value)}%`;
}

    // Flat — keep half-integers (e.g. 2.5 sec) but trim trailing zeros.
    return Number.isInteger(value)
        ? String(value)
        : value.toFixed(2).replace(/\.?0+$/, '');
}

/**
 * Pick the core stats present on this item and shape them for display.
 * Returns an empty array when nothing matches so the UI can hide the
 * row instead of rendering a stub.
 */
function pickCoreStats(
    effects: Record<string, number | string>,
): { label: string; value: string }[] {
    const out: { label: string; value: string }[] = [];

    for (const stat of CORE_STATS) {
        const raw = effects[stat.key];

        if (typeof raw === 'number' && raw !== 0) {
            out.push({ label: stat.label, value: '+' + formatCoreStat(raw, stat.format) });
        }
    }

    return out;
}

/**
 * Detect Tactician's items (Tactician's Cape, Crown, Shield, etc.) so
 * the craftable tab can split them into their own sub-section. Riot
 * doesn't tag them explicitly — display name is the only signal.
 */
function isTacticianItem(item: Item): boolean {
    return item.name.startsWith("Tactician's");
}

export default function ItemsIndex({ items }: Props) {
    const [search, setSearch] = useState('');
    const [activeType, setActiveType] = useState<string>('craftable');

    const countsByType = useMemo(() => {
        const counts: Record<string, number> = {};

        for (const item of items) {
            counts[item.type] = (counts[item.type] ?? 0) + 1;
        }

        return counts;
    }, [items]);

    const availableTypes = useMemo(
        () => TYPE_ORDER.filter((t) => (countsByType[t] ?? 0) > 0),
        [countsByType],
    );

    const filtered = useMemo(() => {
        let list = items.filter((i) => i.type === activeType);

        if (search.trim()) {
            const q = search.toLowerCase();
            list = list.filter(
                (i) =>
                    i.name.toLowerCase().includes(q) ||
                    i.component_1?.name.toLowerCase().includes(q) ||
                    i.component_2?.name.toLowerCase().includes(q),
            );
        }

        return list;
    }, [items, activeType, search]);

    return (
        <>
            <Head title="Items — TFT Scout" />

            <div className="flex flex-col gap-6 p-6">
                <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">
                            Items
                        </h1>
                        <p className="text-sm text-muted-foreground">
                            {items.length} items across {availableTypes.length}{' '}
                            categories. Effects shown are the raw CDragon
                            values.
                        </p>
                    </div>

                    <Input
                        type="search"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search by name or component..."
                        className="max-w-xs"
                    />
                </div>

                <div className="flex flex-wrap gap-2">
                    {availableTypes.map((type) => {
                        const style = TYPE_STYLES[type];
                        const isActive = activeType === type;

                        return (
                            <button
                                key={type}
                                type="button"
                                onClick={() => setActiveType(type)}
                                className={cn(
                                    'rounded-md border px-3 py-1 text-xs font-medium transition-colors',
                                    isActive
                                        ? 'border-foreground bg-foreground text-background'
                                        : 'border-border bg-background hover:border-foreground/40',
                                    !isActive && style.accent,
                                )}
                            >
                                {style.label} · {countsByType[type]}
                            </button>
                        );
                    })}
                </div>

                {filtered.length === 0 ? (
                    <Card className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                        No items match your search.
                    </Card>
                ) : activeType === 'craftable' ? (
                    // Craftable tab is the most heterogeneous: regular
                    // completed items, Tactician's items, and emblems all
                    // share the "you build this from components" mental
                    // model. Split into sub-sections so the player can
                    // scan a single category at a time.
                    <ItemSubsections
                        items={filtered}
                        groups={[
                            {
                                title: 'Completed Items',
                                filter: (i) =>
                                    !isTacticianItem(i) && i.type !== 'emblem',
                            },
                            {
                                title: "Tactician's Items",
                                filter: isTacticianItem,
                            },
                        ]}
                    />
                ) : (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {filtered.map((item) => (
                            <ItemCard key={item.api_name} item={item} />
                        ))}
                    </div>
                )}
            </div>
        </>
    );
}

/**
 * Render a flat item list split into named sub-sections. Each `groups`
 * entry runs its filter against the input list; items that don't match
 * any filter fall into a final "Other" bucket so nothing silently
 * disappears when a new naming convention shows up.
 */
function ItemSubsections({
    items,
    groups,
}: {
    items: Item[];
    groups: { title: string; filter: (item: Item) => boolean }[];
}) {
    const buckets = useMemo(() => {
        const out = groups.map((g) => ({
            title: g.title,
            items: items.filter(g.filter),
        }));
        const used = new Set(out.flatMap((b) => b.items.map((i) => i.api_name)));
        const leftover = items.filter((i) => !used.has(i.api_name));

        if (leftover.length > 0) {
            out.push({ title: 'Other', items: leftover });
        }

        return out.filter((b) => b.items.length > 0);
    }, [items, groups]);

    return (
        <div className="flex flex-col gap-6">
            {buckets.map((bucket) => (
                <section key={bucket.title} className="flex flex-col gap-3">
                    <div className="flex items-baseline justify-between border-b border-border/60 pb-1">
                        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                            {bucket.title}
                        </h2>
                        <span className="text-xs font-mono text-muted-foreground">
                            {bucket.items.length}
                        </span>
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {bucket.items.map((item) => (
                            <ItemCard key={item.api_name} item={item} />
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}

function ItemCard({ item }: { item: Item }) {
    const style = TYPE_STYLES[item.type] ?? TYPE_STYLES.base;

    const descriptionNodes = useMemo(
        () => renderDescription(item.description),
        [item.description],
    );
    const coreStats = useMemo(() => pickCoreStats(item.effects), [item.effects]);
    const effectEntries = Object.entries(item.effects);

    return (
        <Card
            className={cn(
                'flex flex-col gap-4 border-2 p-5 transition-colors',
                style.border,
            )}
        >
            <div className="flex items-start gap-4">
                <div className="flex size-20 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40">
                    <img
                        src={`/icons/items/${item.api_name}.png`}
                        alt={item.name}
                        className="size-16 object-contain"
                        loading="lazy"
                        onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                        }}
                    />
                </div>
                <div className="min-w-0 flex-1">
                    <h3 className="truncate text-lg font-bold tracking-tight">
                        {item.name}
                    </h3>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge
                            variant="outline"
                            className={cn(
                                'px-2 py-0 text-xs font-normal',
                                style.accent,
                            )}
                        >
                            {style.label}
                        </Badge>
                        {item.trait && (
                            <span className="text-xs text-muted-foreground">
                                {item.trait.name}
                            </span>
                        )}
                        {item.tier && (
                            <span className="text-xs text-muted-foreground">
                                {item.tier}
                            </span>
                        )}
                    </div>
                    {coreStats.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {coreStats.map((stat) => (
                                <span
                                    key={stat.label}
                                    className="inline-flex items-center gap-1.5 rounded border border-border/60 bg-muted/40 px-2 py-0.5 font-mono text-xs"
                                >
                                    <span className="font-semibold text-amber-300">
                                        {stat.value}
                                    </span>
                                    <span className="text-muted-foreground">
                                        {stat.label}
                                    </span>
                                </span>
                            ))}
                        </div>
                    )}
                </div>
                {(item.component_1 || item.component_2) && (
                    <div className="flex shrink-0 items-center gap-1 self-start">
                        <RecipeComponent component={item.component_1} />
                        <span className="text-xs text-muted-foreground opacity-60">+</span>
                        <RecipeComponent component={item.component_2} />
                    </div>
                )}
            </div>

            {descriptionNodes.length > 0 ? (
                <p className="text-sm leading-relaxed text-foreground/90">
                    {descriptionNodes}
                </p>
            ) : effectEntries.length > 0 ? (
                <ul className="space-y-1 text-xs">
                    {effectEntries.slice(0, 6).map(([key, value]) => (
                        <li
                            key={key}
                            className="flex justify-between gap-2 font-mono"
                        >
                            <span className="truncate text-muted-foreground">
                                {key}
                            </span>
                            <span>{formatEffectValue(value)}</span>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="text-xs italic text-muted-foreground">
                    No description available.
                </p>
            )}
        </Card>
    );
}

function RecipeComponent({
    component,
}: {
    component: ItemComponent | null;
}) {
    if (!component) {
        return <span className="opacity-40">?</span>;
    }

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span className="inline-flex size-8 items-center justify-center overflow-hidden rounded border border-border bg-muted/40">
                    <img
                        src={`/icons/items/${component.api_name}.png`}
                        alt={component.name}
                        className="size-7 object-contain"
                        loading="lazy"
                        onError={(e) => {
                            (e.target as HTMLImageElement).style.display =
                                'none';
                        }}
                    />
                </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
                {component.name}
            </TooltipContent>
        </Tooltip>
    );
}

/**
 * Same heuristic as traits: magnitude < 1 → percent, otherwise flat.
 * Imperfect (AS=15 is flat %, AD=0.15 is fractional %) until we have a
 * per-field units table from CDragon bin parsing.
 */
function formatEffectValue(value: number | string): string {
    if (typeof value === 'string') {
return value;
}

    if (Math.abs(value) > 0 && Math.abs(value) < 1) {
        return `${(value * 100).toFixed(0)}%`;
    }

    return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

ItemsIndex.layout = (page: React.ReactNode) => (
    <AppLayout
        breadcrumbs={[
            { title: 'Browse', href: '#' },
            { title: 'Items', href: '/items' },
        ]}
    >
        {page}
    </AppLayout>
);
