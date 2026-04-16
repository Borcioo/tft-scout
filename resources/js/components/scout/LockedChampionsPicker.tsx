import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Champion } from '@/workers/scout/types';

type Props = {
    champions: Champion[];
    locked: string[];
    onChange: (locked: string[]) => void;
};

const COST_COLORS: Record<number, string> = {
    1: 'border-gray-400',
    2: 'border-green-500',
    3: 'border-blue-500',
    4: 'border-purple-500',
    5: 'border-yellow-500',
};

const COSTS = [1, 2, 3, 4, 5] as const;

export function LockedChampionsPicker({ champions, locked, onChange }: Props) {
    const [query, setQuery] = useState('');
    const [costFilter, setCostFilter] = useState<number | null>(null);

    const lockedSet = new Set(locked);

    const filtered = champions
        .filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
        .filter((c) => costFilter === null || c.cost === costFilter)
        .sort((a, b) => {
            const aLocked = lockedSet.has(a.apiName) ? 0 : 1;
            const bLocked = lockedSet.has(b.apiName) ? 0 : 1;

            if (aLocked !== bLocked) {
return aLocked - bLocked;
}

            if (a.cost !== b.cost) {
return a.cost - b.cost;
}

            return a.name.localeCompare(b.name);
        });

    const toggle = (apiName: string) => {
        if (lockedSet.has(apiName)) {
            onChange(locked.filter((a) => a !== apiName));
        } else if (locked.length < 10) {
            onChange([...locked, apiName]);
        }
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-3 rounded-lg border bg-card p-4">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Locked champions ({locked.length}/10)
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
                        onClick={() => setCostFilter(costFilter === cost ? null : cost)}
                    >
                        {cost}g
                    </Badge>
                ))}
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
                {filtered.map((champ) => (
                    <div
                        key={champ.apiName}
                        className={`flex cursor-pointer items-center gap-2 rounded border p-2 text-sm ${
                            COST_COLORS[champ.cost] ?? 'border-gray-400'
                        } ${lockedSet.has(champ.apiName) ? 'bg-accent' : ''}`}
                        onClick={() => toggle(champ.apiName)}
                    >
                        <Badge
                            variant={lockedSet.has(champ.apiName) ? 'default' : 'outline'}
                            className="size-5 shrink-0 items-center justify-center p-0 text-xs"
                        >
                            {lockedSet.has(champ.apiName) ? '✓' : ''}
                        </Badge>
                        <img
                            src={champ.icon}
                            alt=""
                            className="size-5 rounded-sm"
                        />
                        <span>{champ.name}</span>
                        <span className="ml-auto text-xs text-muted-foreground">{champ.cost}g</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
