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

export function LockedChampionsPicker({ champions, locked, onChange }: Props) {
    const [query, setQuery] = useState('');

    const filtered = champions
        .filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
        .slice(0, 12);

    const toggle = (apiName: string) => {
        if (locked.includes(apiName)) {
            onChange(locked.filter((a) => a !== apiName));
        } else if (locked.length < 10) {
            onChange([...locked, apiName]);
        }
    };

    return (
        <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Locked champions ({locked.length}/10)
            </Label>
            <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
            />
            <div className="flex flex-wrap gap-1.5">
                {locked.map((apiName) => {
                    const champ = champions.find((c) => c.apiName === apiName);

                    if (!champ) {
return null;
}

                    return (
                        <Badge
                            key={apiName}
                            variant="default"
                            className="cursor-pointer gap-1"
                            onClick={() => toggle(apiName)}
                        >
                            <img
                                src={champ.icon}
                                alt=""
                                className="size-4 rounded-sm"
                            />
                            {champ.name}
                            <span className="ml-0.5 opacity-70">×</span>
                        </Badge>
                    );
                })}
            </div>
            <div className="flex flex-wrap gap-1.5">
                {filtered.map((champ) => (
                    <Badge
                        key={champ.apiName}
                        variant={
                            locked.includes(champ.apiName) ? 'default' : 'outline'
                        }
                        className="cursor-pointer gap-1"
                        onClick={() => toggle(champ.apiName)}
                    >
                        <img
                            src={champ.icon}
                            alt=""
                            className="size-4 rounded-sm"
                        />
                        {champ.name}
                    </Badge>
                ))}
            </div>
        </div>
    );
}
