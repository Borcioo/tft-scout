import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { ItemIconStack } from './ItemIconStack';
import { PlaceChangeBadge } from './PlaceChangeBadge';
import type { Tier } from './ItemTierBadge';

export type TopPickRow = {
    items: string[];         // 1..3 api_names
    names: string[];         // parallel display names
    icons: (string | null)[]; // parallel icon paths
    avg_place: number;
    place_change: number | null;
    frequency: number;
    tier: Tier | null;
};

type Props = {
    title: string;
    rows: TopPickRow[];
    championName: string;
    emptyHint: string;
};

/**
 * 5-row compact card for "Recommended Builds" / "Top Items" on the
 * champion detail page. Rows sorted by avg_place (slice from parent).
 *
 * Header summary auto-generated from top row — no NLP, simple template.
 */
export function TopPickCard({ title, rows, championName, emptyHint }: Props) {
    const top = rows[0];
    const topByFreq = [...rows].sort((a, b) => b.frequency - a.frequency)[0];

    const summary = top && topByFreq
        ? `We recommend ${joinNames(top.names)} as the best build for ${championName}. Most popular: ${joinNames(topByFreq.names)}.`
        : emptyHint;

    return (
        <Card className="h-full">
            <CardHeader>
                <CardTitle className="text-base">{title}</CardTitle>
                <CardDescription className="text-xs leading-relaxed">{summary}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
                {rows.length === 0 ? (
                    <p className="text-xs text-muted-foreground">{emptyHint}</p>
                ) : (
                    rows.map((row, idx) => (
                        <div
                            key={row.items.join('|') + idx}
                            className={cn(
                                'grid grid-cols-[auto_1fr] items-center gap-3 rounded border border-border/60 bg-muted/20 p-2',
                            )}
                        >
                            <ItemIconStack
                                apiNames={row.items}
                                names={row.names}
                                icons={row.icons}
                                size="sm"
                            />
                            <div className="grid grid-cols-3 gap-2 text-xs">
                                <Stat label="Avg Place" value={row.avg_place.toFixed(2)} highlight />
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                                        Place Δ
                                    </span>
                                    <PlaceChangeBadge value={row.place_change} />
                                </div>
                                <Stat label="Play Rate" value={`${(row.frequency * 100).toFixed(1)}%`} />
                            </div>
                        </div>
                    ))
                )}
            </CardContent>
        </Card>
    );
}

function joinNames(names: string[]): string {
    if (names.length === 0) return '—';
    if (names.length === 1) return names[0];
    const head = names.slice(0, -1).join(', ');
    return `${head} and ${names[names.length - 1]}`;
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
    return (
        <div className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
            <span className={cn('font-mono', highlight && 'text-amber-500')}>{value}</span>
        </div>
    );
}
