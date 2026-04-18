import { router } from '@inertiajs/react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { ItemIconStack } from './ItemIconStack';
import { ItemTierBadge } from './ItemTierBadge';
import type { Tier } from './ItemTierBadge';
import type { BuildsMeta } from './MetaTftPerformanceSection';
import { PlaceChangeBadge } from './PlaceChangeBadge';

type Row = {
    items: string[];
    names: string[];
    icons: (string | null)[];
    games: number;
    avg_place: number;
    place_change: number | null;
    win_rate: number;
    top4_rate: number;
    frequency: number;
    tier: Tier | null;
};

type Props = {
    title: string;
    rows: Row[];
    emptyHint: string;
    /** When present, table becomes server-sorted + paginated via Inertia
     *  partial reload. Absent = legacy client-only render (used for
     *  single-items tab). */
    serverMeta?: BuildsMeta;
};

// Column key → SQL sort token the backend recognises.
type Column = {
    key: string;
    label: string;
    align?: 'right';
    defaultDir: 'asc' | 'desc';
};

const COLUMNS: Column[] = [
    { key: 'items', label: 'Items', defaultDir: 'asc' },
    { key: 'tier', label: 'Tier', defaultDir: 'desc' },
    { key: 'avg_place', label: 'Avg Place', align: 'right', defaultDir: 'asc' },
    { key: 'place_change', label: 'Place Δ', align: 'right', defaultDir: 'asc' },
    { key: 'win_rate', label: 'Win Rate', align: 'right', defaultDir: 'desc' },
    { key: 'top4_rate', label: 'Top 4', align: 'right', defaultDir: 'desc' },
    { key: 'frequency', label: 'Freq', align: 'right', defaultDir: 'desc' },
    { key: 'games', label: 'Games', align: 'right', defaultDir: 'desc' },
];

export function ItemStatsTable({ title, rows, emptyHint, serverMeta }: Props) {
    const [loading, setLoading] = useState(false);

    // Columns that aren't pure row data (e.g. `items`) aren't sortable
    // server-side. Everything else maps 1:1 to a DB column or the
    // weighted expression (default).
    const isSortable = (key: string) =>
        key !== 'items' && serverMeta !== undefined;

    const handleSort = (col: Column) => {
        if (!serverMeta || !isSortable(col.key)) return;
        // Toggle direction if clicking the active column, else use default.
        const nextDir =
            serverMeta.sort === col.key
                ? serverMeta.dir === 'asc'
                    ? 'desc'
                    : 'asc'
                : col.defaultDir;
        setLoading(true);
        router.reload({
            only: ['metatft'],
            data: {
                buildsSort: col.key,
                buildsDir: nextDir,
                buildsLimit: serverMeta.limit,
            },
            onFinish: () => setLoading(false),
        });
    };

    const handleLoadMore = () => {
        if (!serverMeta) return;
        setLoading(true);
        router.reload({
            only: ['metatft'],
            data: {
                buildsSort: serverMeta.sort,
                buildsDir: serverMeta.dir,
                buildsLimit: serverMeta.limit + 20,
            },
            onFinish: () => setLoading(false),
        });
    };

    const sortIcon = (col: Column) => {
        if (!serverMeta || !isSortable(col.key)) return null;
        if (serverMeta.sort !== col.key) {
            return <ArrowUpDown className="ml-1 inline size-3 opacity-40" />;
        }
        return serverMeta.dir === 'asc' ? (
            <ArrowUp className="ml-1 inline size-3 text-amber-400" />
        ) : (
            <ArrowDown className="ml-1 inline size-3 text-amber-400" />
        );
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">{title}</CardTitle>
            </CardHeader>
            <CardContent>
                {rows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{emptyHint}</p>
                ) : (
                    <>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b text-left text-xs text-muted-foreground">
                                        {COLUMNS.map((col) => {
                                            const clickable = isSortable(col.key);
                                            const active =
                                                serverMeta?.sort === col.key;
                                            return (
                                                <th
                                                    key={col.key}
                                                    onClick={
                                                        clickable
                                                            ? () => handleSort(col)
                                                            : undefined
                                                    }
                                                    className={cn(
                                                        'py-2 pr-4',
                                                        col.align === 'right' &&
                                                            'text-right',
                                                        clickable &&
                                                            'cursor-pointer select-none hover:text-foreground',
                                                        active &&
                                                            'font-semibold text-amber-400',
                                                    )}
                                                >
                                                    {col.label}
                                                    {sortIcon(col)}
                                                </th>
                                            );
                                        })}
                                    </tr>
                                </thead>
                                <tbody
                                    className={cn(
                                        loading && 'opacity-60 transition-opacity',
                                    )}
                                >
                                    {rows.map((row, idx) => (
                                        <tr
                                            key={row.items.join('|') + idx}
                                            className="border-b border-border/40 hover:bg-muted/30"
                                        >
                                            <td className="py-2 pr-4">
                                                <ItemIconStack
                                                    apiNames={row.items}
                                                    names={row.names}
                                                    icons={row.icons}
                                                    size="sm"
                                                />
                                            </td>
                                            <td className="py-2 pr-4">
                                                <ItemTierBadge tier={row.tier} />
                                            </td>
                                            <td className="py-2 pr-4 text-right font-mono">
                                                {row.avg_place.toFixed(2)}
                                            </td>
                                            <td className="py-2 pr-4 text-right">
                                                <PlaceChangeBadge
                                                    value={row.place_change}
                                                />
                                            </td>
                                            <td className="py-2 pr-4 text-right font-mono">
                                                {(row.win_rate * 100).toFixed(1)}%
                                            </td>
                                            <td className="py-2 pr-4 text-right font-mono">
                                                {(row.top4_rate * 100).toFixed(1)}%
                                            </td>
                                            <td className="py-2 pr-4 text-right font-mono">
                                                {(row.frequency * 100).toFixed(1)}%
                                            </td>
                                            <td className="py-2 text-right font-mono text-muted-foreground">
                                                {row.games}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {serverMeta && (
                            <div className="mt-3 flex items-center justify-between gap-3">
                                <span className="text-xs text-muted-foreground">
                                    Showing {rows.length} of {serverMeta.total}
                                </span>
                                {serverMeta.has_more && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={handleLoadMore}
                                        disabled={loading}
                                    >
                                        {loading ? 'Loading…' : 'Load more'}
                                    </Button>
                                )}
                            </div>
                        )}
                    </>
                )}
            </CardContent>
        </Card>
    );
}
