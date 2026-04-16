import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Trait } from '@/workers/scout/types';

type EmblemEntry = { apiName: string; count: number };

type Props = {
    traits: Trait[];
    emblems: EmblemEntry[];
    onChange: (emblems: EmblemEntry[]) => void;
};

const COUNTS = [0, 1, 2, 3, 4, 5];

export function EmblemPicker({ traits, emblems, onChange }: Props) {
    const [query, setQuery] = useState('');

    const activeSet = new Set(emblems.map((e) => e.apiName));

    const filtered = traits
        .filter((t) => t.category === 'public')
        .filter((t) => t.name.toLowerCase().includes(query.toLowerCase()))
        .sort((a, b) => {
            const aActive = activeSet.has(a.apiName) ? 0 : 1;
            const bActive = activeSet.has(b.apiName) ? 0 : 1;

            return aActive - bActive;
        });

    const setCount = (apiName: string, count: number) => {
        if (count <= 0) {
            onChange(emblems.filter((e) => e.apiName !== apiName));

            return;
        }

        const existing = emblems.find((e) => e.apiName === apiName);

        if (existing) {
            onChange(
                emblems.map((e) =>
                    e.apiName === apiName ? { ...e, count } : e,
                ),
            );
        } else {
            onChange([...emblems, { apiName, count }]);
        }
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-3 rounded-lg border bg-card p-4">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Emblems ({emblems.reduce((n, e) => n + e.count, 0)})
            </Label>
            <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search emblems…"
            />
            <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
                {filtered.map((trait) => {
                    const entry = emblems.find(
                        (e) => e.apiName === trait.apiName,
                    );
                    const current = entry?.count ?? 0;

                    return (
                        <div
                            key={trait.apiName}
                            className="flex flex-col gap-1.5 rounded border p-2 text-sm"
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
                                {COUNTS.map((n) => (
                                    <Badge
                                        key={n}
                                        variant={
                                            current === n && n > 0
                                                ? 'default'
                                                : 'outline'
                                        }
                                        className="cursor-pointer"
                                        onClick={() => setCount(trait.apiName, n)}
                                    >
                                        {n}
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
