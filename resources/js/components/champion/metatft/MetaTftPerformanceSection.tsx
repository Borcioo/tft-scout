import { Info } from 'lucide-react';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Toggle } from '@/components/ui/toggle';
import { ItemStatsTable } from './ItemStatsTable';
import type { Tier } from './ItemTierBadge';

type ItemType = 'base' | 'craftable' | 'radiant' | 'support' | 'artifact' | 'trait_item';

type ItemSingle = {
    api_name: string;
    name: string;
    icon: string | null;
    type: ItemType | null;
    is_tactician: boolean;
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
    types: (ItemType | null)[];
    is_tactician: boolean[];
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

    const [hideRadiant, setHideRadiant] = useState(false);
    const [hideArtifact, setHideArtifact] = useState(false);

    // Tactician hatbox items (TacticiansRing/Scepter/ForceOfNature) are
    // never combat-relevant for a champion's BIS — always filtered.
    const shouldHide = (types: (ItemType | null)[], tactFlags: boolean[]): boolean => {
        if (tactFlags.some((f) => f)) {
            return true;
        }

        if (hideRadiant && types.some((t) => t === 'radiant')) {
            return true;
        }

        if (hideArtifact && types.some((t) => t === 'artifact')) {
            return true;
        }

        return false;
    };

    const filteredSingle = data.items_single.filter(
        (r) => !shouldHide([r.type], [r.is_tactician]),
    );
    const filteredBuilds = data.items_builds.filter(
        (r) => !shouldHide(r.types, r.is_tactician),
    );

    // Normalize items_single rows into the same shape ItemStatsTable expects
    const singleRows = filteredSingle.map((r) => ({
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
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <TabsList>
                            <TabsTrigger value="builds">
                                Builds ({filteredBuilds.length})
                            </TabsTrigger>
                            <TabsTrigger value="singles">
                                Single items ({singleRows.length})
                            </TabsTrigger>
                        </TabsList>
                        <div className="flex items-center gap-2">
                            <Toggle
                                size="sm"
                                variant="outline"
                                pressed={hideRadiant}
                                onPressedChange={setHideRadiant}
                            >
                                Hide radiant
                            </Toggle>
                            <Toggle
                                size="sm"
                                variant="outline"
                                pressed={hideArtifact}
                                onPressedChange={setHideArtifact}
                            >
                                Hide artifacts
                            </Toggle>
                        </div>
                    </div>
                    <TabsContent value="builds">
                        <ItemStatsTable
                            title="All item builds"
                            rows={filteredBuilds}
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
