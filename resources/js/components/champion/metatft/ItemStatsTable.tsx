import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ItemIconStack } from './ItemIconStack';
import { ItemTierBadge  } from './ItemTierBadge';
import type {Tier} from './ItemTierBadge';
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
};

/**
 * Full sortable table for builds or single items. Expects rows pre-sorted
 * by avg_place ASC from the server.
 */
export function ItemStatsTable({ title, rows, emptyHint }: Props) {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">{title}</CardTitle>
            </CardHeader>
            <CardContent>
                {rows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{emptyHint}</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b text-left text-xs text-muted-foreground">
                                    <th className="py-2 pr-4">Items</th>
                                    <th className="py-2 pr-4">Tier</th>
                                    <th className="py-2 pr-4 text-right">Avg Place</th>
                                    <th className="py-2 pr-4 text-right">Place Δ</th>
                                    <th className="py-2 pr-4 text-right">Win Rate</th>
                                    <th className="py-2 pr-4 text-right">Top 4</th>
                                    <th className="py-2 pr-4 text-right">Freq</th>
                                    <th className="py-2 text-right">Games</th>
                                </tr>
                            </thead>
                            <tbody>
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
                                            <PlaceChangeBadge value={row.place_change} />
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
                )}
            </CardContent>
        </Card>
    );
}
