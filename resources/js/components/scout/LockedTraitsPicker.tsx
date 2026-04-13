import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Trait } from '@/workers/scout/types';

type LockedTrait = { apiName: string; minUnits: number };

type Props = {
    traits: Trait[];
    locked: LockedTrait[];
    onChange: (locked: LockedTrait[]) => void;
};

export function LockedTraitsPicker({ traits, locked, onChange }: Props) {
    const [query, setQuery] = useState('');

    const filtered = traits
        .filter((t) => t.category === 'public')
        .filter((t) => t.name.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 15);

    const setMinUnits = (apiName: string, minUnits: number) => {
        const existing = locked.find((l) => l.apiName === apiName);
        if (!existing) {
            onChange([...locked, { apiName, minUnits }]);
        } else if (minUnits === 0) {
            onChange(locked.filter((l) => l.apiName !== apiName));
        } else {
            onChange(
                locked.map((l) =>
                    l.apiName === apiName ? { ...l, minUnits } : l,
                ),
            );
        }
    };

    return (
        <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Locked traits ({locked.length})
            </Label>
            <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search traits…"
            />
            <div className="flex flex-col gap-1.5">
                {filtered.map((trait) => {
                    const lockedEntry = locked.find(
                        (l) => l.apiName === trait.apiName,
                    );
                    return (
                        <div
                            key={trait.apiName}
                            className="flex items-center justify-between gap-2 rounded border p-2 text-sm"
                        >
                            <span className="flex items-center gap-2">
                                <img
                                    src={trait.icon}
                                    alt=""
                                    className="size-5"
                                />
                                {trait.name}
                            </span>
                            <div className="flex gap-1">
                                {trait.breakpoints.map((bp) => (
                                    <Badge
                                        key={bp.position}
                                        variant={
                                            lockedEntry?.minUnits === bp.minUnits
                                                ? 'default'
                                                : 'outline'
                                        }
                                        className="cursor-pointer"
                                        onClick={() =>
                                            setMinUnits(
                                                trait.apiName,
                                                lockedEntry?.minUnits === bp.minUnits
                                                    ? 0
                                                    : bp.minUnits,
                                            )
                                        }
                                    >
                                        {bp.minUnits}
                                    </Badge>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
