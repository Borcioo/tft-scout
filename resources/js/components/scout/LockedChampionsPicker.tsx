import { Ban, Lock } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { Champion } from '@/workers/scout/types';

type Props = {
    champions: Champion[];
    locked: string[];
    excluded: string[];
    onChangeLocked: (locked: string[]) => void;
    onChangeExcluded: (excluded: string[]) => void;
};

const COST_COLORS: Record<number, string> = {
    1: 'border-gray-400',
    2: 'border-green-500',
    3: 'border-blue-500',
    4: 'border-purple-500',
    5: 'border-yellow-500',
};

const COSTS = [1, 2, 3, 4, 5] as const;

/**
 * Per-champion pick state machine: none → locked → excluded → none
 * (via two independent toggle buttons). Locked = "must be in the team",
 * excluded = "never consider". Mutually exclusive — toggling one clears
 * the other. Engine already accepts `excludedChampions` via ScoutParams.
 */
export function LockedChampionsPicker({
    champions,
    locked,
    excluded,
    onChangeLocked,
    onChangeExcluded,
}: Props) {
    const [query, setQuery] = useState('');
    const [costFilter, setCostFilter] = useState<number | null>(null);

    const lockedSet = new Set(locked);
    const excludedSet = new Set(excluded);

    const filtered = champions
        .filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
        .filter((c) => costFilter === null || c.cost === costFilter)
        .sort((a, b) => {
            // Locked first, then excluded, then rest.
            const aRank = lockedSet.has(a.apiName)
                ? 0
                : excludedSet.has(a.apiName)
                  ? 1
                  : 2;
            const bRank = lockedSet.has(b.apiName)
                ? 0
                : excludedSet.has(b.apiName)
                  ? 1
                  : 2;
            if (aRank !== bRank) return aRank - bRank;
            if (a.cost !== b.cost) return a.cost - b.cost;
            return a.name.localeCompare(b.name);
        });

    const toggleLock = (apiName: string) => {
        if (lockedSet.has(apiName)) {
            onChangeLocked(locked.filter((a) => a !== apiName));
            return;
        }
        if (locked.length >= 10) return;
        // Lock wins over exclude.
        if (excludedSet.has(apiName)) {
            onChangeExcluded(excluded.filter((a) => a !== apiName));
        }
        onChangeLocked([...locked, apiName]);
    };

    const toggleExclude = (apiName: string) => {
        if (excludedSet.has(apiName)) {
            onChangeExcluded(excluded.filter((a) => a !== apiName));
            return;
        }
        // Exclude wins over lock.
        if (lockedSet.has(apiName)) {
            onChangeLocked(locked.filter((a) => a !== apiName));
        }
        onChangeExcluded([...excluded, apiName]);
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-3 rounded-lg border bg-card p-4">
            <Label className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                Champions
                <span className="font-normal normal-case">
                    · locked {locked.length}/10 · banned {excluded.length}
                </span>
            </Label>
            <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search champions…"
            />
            <div className="flex gap-1">
                <Badge
                    variant={costFilter === null ? 'default' : 'outline'}
                    className="cursor-pointer"
                    onClick={() => setCostFilter(null)}
                >
                    All
                </Badge>
                {COSTS.map((cost) => (
                    <Badge
                        key={cost}
                        variant={costFilter === cost ? 'default' : 'outline'}
                        className="cursor-pointer"
                        onClick={() =>
                            setCostFilter(costFilter === cost ? null : cost)
                        }
                    >
                        {cost}g
                    </Badge>
                ))}
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
                {filtered.map((champ) => {
                    const isLocked = lockedSet.has(champ.apiName);
                    const isExcluded = excludedSet.has(champ.apiName);

                    return (
                        <div
                            key={champ.apiName}
                            className={cn(
                                'flex items-center gap-2 rounded border p-2 text-sm',
                                COST_COLORS[champ.cost] ?? 'border-gray-400',
                                isLocked && 'bg-accent',
                                isExcluded && 'bg-red-950/30 opacity-70',
                            )}
                        >
                            <img
                                src={champ.icon}
                                alt=""
                                className={cn(
                                    'size-5 rounded-sm',
                                    isExcluded && 'grayscale',
                                )}
                            />
                            <span
                                className={cn(
                                    'min-w-0 flex-1 truncate',
                                    isExcluded && 'line-through',
                                )}
                            >
                                {champ.name}
                            </span>
                            <span className="text-xs text-muted-foreground">
                                {champ.cost}g
                            </span>
                            <button
                                type="button"
                                onClick={() => toggleLock(champ.apiName)}
                                title={isLocked ? 'Unlock' : 'Lock (must include)'}
                                className={cn(
                                    'flex size-6 shrink-0 items-center justify-center rounded border transition-colors',
                                    isLocked
                                        ? 'border-emerald-500 bg-emerald-500/20 text-emerald-400'
                                        : 'border-border hover:border-emerald-500/50 hover:text-emerald-400',
                                )}
                            >
                                <Lock className="size-3" />
                            </button>
                            <button
                                type="button"
                                onClick={() => toggleExclude(champ.apiName)}
                                title={isExcluded ? 'Unban' : 'Ban (never include)'}
                                className={cn(
                                    'flex size-6 shrink-0 items-center justify-center rounded border transition-colors',
                                    isExcluded
                                        ? 'border-red-500 bg-red-500/20 text-red-400'
                                        : 'border-border hover:border-red-500/50 hover:text-red-400',
                                )}
                            >
                                <Ban className="size-3" />
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
