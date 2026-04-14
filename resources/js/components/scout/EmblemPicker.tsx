import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { Trait } from '@/workers/scout/types';

type EmblemEntry = { apiName: string; count: number };

type Props = {
    traits: Trait[];
    emblems: EmblemEntry[];
    onChange: (emblems: EmblemEntry[]) => void;
};

export function EmblemPicker({ traits, emblems, onChange }: Props) {
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
        <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                Emblems ({emblems.reduce((n, e) => n + e.count, 0)})
            </Label>
            <div className="flex flex-wrap gap-1.5">
                {emblems.map((entry) => {
                    const trait = traits.find(
                        (t) => t.apiName === entry.apiName,
                    );

                    if (!trait) {
return null;
}

                    return (
                        <Badge
                            key={entry.apiName}
                            variant="default"
                            className="gap-1"
                        >
                            <img
                                src={trait.icon}
                                alt=""
                                className="size-4"
                            />
                            {trait.name} ×{entry.count}
                            <button
                                type="button"
                                className="ml-1 opacity-70"
                                onClick={() =>
                                    setCount(entry.apiName, entry.count - 1)
                                }
                            >
                                −
                            </button>
                            <button
                                type="button"
                                className="opacity-70"
                                onClick={() =>
                                    setCount(entry.apiName, entry.count + 1)
                                }
                            >
                                +
                            </button>
                        </Badge>
                    );
                })}
            </div>
            <div className="flex flex-wrap gap-1">
                {traits
                    .filter((t) => t.category === 'public')
                    .slice(0, 20)
                    .map((trait) => (
                        <Button
                            key={trait.apiName}
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1 px-2 text-xs"
                            onClick={() => setCount(trait.apiName, 1)}
                        >
                            <img
                                src={trait.icon}
                                alt=""
                                className="size-4"
                            />
                            {trait.name}
                        </Button>
                    ))}
            </div>
        </div>
    );
}
