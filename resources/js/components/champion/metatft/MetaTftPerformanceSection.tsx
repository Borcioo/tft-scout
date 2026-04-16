import { Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ItemStatsTable } from './ItemStatsTable';
import type { Tier } from './ItemTierBadge';

type ItemSingle = {
    api_name: string;
    name: string;
    icon: string | null;
    games: number;
    avg_place: number;
    place_change: number | null;
    win_rate: number;
    top4_rate: number;
    frequency: number;
    tier: Tier | null;
};

type ItemBuild = {
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

export type MetaTftData = {
    items_single: ItemSingle[];
    items_builds: ItemBuild[];
    synced_at: string | null;
};

type Props = {
    data: MetaTftData;
};

/**
 * Wrapper for the MetaTFT Performance block below the hero. Shows empty
 * state banner when no data synced yet, otherwise renders the two full
 * tables. Top-5 cards live in the hero (separate component) so they
 * can be placed in the 4-col grid.
 */
export function MetaTftPerformanceSection({ data }: Props) {
    const hasData = data.items_single.length > 0 || data.items_builds.length > 0;

    // Normalize items_single rows into the same shape ItemStatsTable expects
    const singleRows = data.items_single.map((r) => ({
        items: [r.api_name],
        names: [r.name],
        icons: [r.icon],
        games: r.games,
        avg_place: r.avg_place,
        place_change: r.place_change,
        win_rate: r.win_rate,
        top4_rate: r.top4_rate,
        frequency: r.frequency,
        tier: r.tier,
    }));

    return (
        <div className="flex flex-col gap-4">
            {!hasData && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">MetaTFT Performance</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="inline-flex items-center gap-2 rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-600 dark:text-amber-400">
                            <Info className="size-3" />
                            MetaTFT data not synced yet — run{' '}
                            <code className="rounded bg-muted px-1">php artisan metatft:sync</code>
                        </div>
                    </CardContent>
                </Card>
            )}

            {hasData && (
                <Tabs defaultValue="builds">
                    <TabsList>
                        <TabsTrigger value="builds">
                            Builds ({data.items_builds.length})
                        </TabsTrigger>
                        <TabsTrigger value="singles">
                            Single items ({singleRows.length})
                        </TabsTrigger>
                    </TabsList>
                    <TabsContent value="builds">
                        <ItemStatsTable
                            title="All item builds"
                            rows={data.items_builds}
                            emptyHint="No builds logged yet."
                        />
                    </TabsContent>
                    <TabsContent value="singles">
                        <ItemStatsTable
                            title="All single items"
                            rows={singleRows}
                            emptyHint="No items logged yet."
                        />
                    </TabsContent>
                    <p className="text-xs text-muted-foreground">
                        {data.synced_at && (
                            <>Last updated {new Date(data.synced_at).toLocaleString()}. </>
                        )}
                        Items with fewer than 15 games are shown without a tier. Data from MetaTFT.
                    </p>
                </Tabs>
            )}
        </div>
    );
}
