import { Check, ChevronsUpDown, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export type ChampOption = {
    apiName: string;
    name: string;
    /** Always a path — backend constructs `/icons/champions/X.png` for every row. */
    icon: string;
    cost: number;
};

export type TraitOption = {
    apiName: string;
    name: string;
    /** May be null — traits in meta snapshot sometimes lack icons. */
    icon: string | null;
};

type Props = {
    query: string;
    onQueryChange: (q: string) => void;
    championOptions: ChampOption[];
    selectedChampions: string[];
    onChampionsChange: (apiNames: string[]) => void;
    traitOptions: TraitOption[];
    selectedTraits: string[];
    onTraitsChange: (apiNames: string[]) => void;
    /** Shown as "X of Y plans" — purely informational. */
    matchedCount: number;
    totalCount: number;
};

const COST_BORDER: Record<number, string> = {
    1: 'border-zinc-500',
    2: 'border-green-500',
    3: 'border-blue-500',
    4: 'border-purple-500',
    5: 'border-yellow-500',
};

export function PlansFilterBar({
    query,
    onQueryChange,
    championOptions,
    selectedChampions,
    onChampionsChange,
    traitOptions,
    selectedTraits,
    onTraitsChange,
    matchedCount,
    totalCount,
}: Props) {
    const hasFilters =
        query.trim() !== '' ||
        selectedChampions.length > 0 ||
        selectedTraits.length > 0;

    const clearAll = () => {
        onQueryChange('');
        onChampionsChange([]);
        onTraitsChange([]);
    };

    return (
        <div className="flex flex-col gap-2 rounded-lg border bg-card p-3">
            <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[220px] flex-1">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        type="search"
                        value={query}
                        onChange={(e) => onQueryChange(e.target.value)}
                        placeholder="Search plans by name, trait or champion…"
                        className="pl-8"
                    />
                </div>

                <MultiSelect
                    label="Champions"
                    options={championOptions.map((c) => ({
                        value: c.apiName,
                        label: c.name,
                        icon: c.icon,
                        accent: COST_BORDER[c.cost] ?? 'border-zinc-500',
                    }))}
                    selected={selectedChampions}
                    onChange={onChampionsChange}
                    emptyText="No champions in your plans"
                />

                <MultiSelect
                    label="Traits"
                    options={traitOptions.map((t) => ({
                        value: t.apiName,
                        label: t.name,
                        icon: t.icon,
                        accent: 'border-zinc-600',
                    }))}
                    selected={selectedTraits}
                    onChange={onTraitsChange}
                    emptyText="No traits in your plans"
                />

                {hasFilters && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={clearAll}
                        className="h-9 gap-1 text-xs"
                    >
                        <X className="size-3.5" />
                        Clear
                    </Button>
                )}

                <span className="ml-auto text-xs text-muted-foreground">
                    {matchedCount} of {totalCount} plans
                </span>
            </div>

            {(selectedChampions.length > 0 || selectedTraits.length > 0) && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    {selectedChampions.map((api) => {
                        const c = championOptions.find((o) => o.apiName === api);
                        if (!c) return null;
                        return (
                            <Badge
                                key={api}
                                variant="secondary"
                                className="gap-1 pr-1"
                            >
                                {c.icon && (
                                    <img src={c.icon} alt="" className="size-3.5 rounded-sm" />
                                )}
                                {c.name}
                                <button
                                    type="button"
                                    onClick={() =>
                                        onChampionsChange(
                                            selectedChampions.filter((a) => a !== api),
                                        )
                                    }
                                    className="rounded-sm p-0.5 hover:bg-muted"
                                    aria-label={`Remove ${c.name} filter`}
                                >
                                    <X className="size-3" />
                                </button>
                            </Badge>
                        );
                    })}
                    {selectedTraits.map((api) => {
                        const t = traitOptions.find((o) => o.apiName === api);
                        if (!t) return null;
                        return (
                            <Badge
                                key={api}
                                variant="secondary"
                                className="gap-1 pr-1"
                            >
                                {t.icon && (
                                    <img src={t.icon} alt="" className="size-3.5" />
                                )}
                                {t.name}
                                <button
                                    type="button"
                                    onClick={() =>
                                        onTraitsChange(
                                            selectedTraits.filter((a) => a !== api),
                                        )
                                    }
                                    className="rounded-sm p-0.5 hover:bg-muted"
                                    aria-label={`Remove ${t.name} filter`}
                                >
                                    <X className="size-3" />
                                </button>
                            </Badge>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

// ── Internal multiselect popover ────────────────────────────────────

type Option = {
    value: string;
    label: string;
    icon: string | null;
    accent: string;
};

function MultiSelect({
    label,
    options,
    selected,
    onChange,
    emptyText,
}: {
    label: string;
    options: Option[];
    selected: string[];
    onChange: (next: string[]) => void;
    emptyText: string;
}) {
    const [open, setOpen] = useState(false);
    const selectedSet = useMemo(() => new Set(selected), [selected]);

    const toggle = (value: string) => {
        if (selectedSet.has(value)) {
            onChange(selected.filter((v) => v !== value));
        } else {
            onChange([...selected, value]);
        }
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    size="sm"
                    role="combobox"
                    aria-expanded={open}
                    className="h-9 min-w-[140px] justify-between gap-2"
                >
                    <span className="truncate">
                        {label}
                        {selected.length > 0 && (
                            <span className="ml-1 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                                {selected.length}
                            </span>
                        )}
                    </span>
                    <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[280px] p-0" align="start">
                <Command>
                    <CommandInput placeholder={`Search ${label.toLowerCase()}…`} />
                    <CommandList>
                        <CommandEmpty>{emptyText}</CommandEmpty>
                        <CommandGroup>
                            {options.map((opt) => {
                                const isSelected = selectedSet.has(opt.value);
                                return (
                                    <CommandItem
                                        key={opt.value}
                                        value={opt.label}
                                        onSelect={() => toggle(opt.value)}
                                        className="gap-2"
                                    >
                                        {opt.icon ? (
                                            <img
                                                src={opt.icon}
                                                alt=""
                                                className={cn(
                                                    'size-5 rounded border',
                                                    opt.accent,
                                                )}
                                            />
                                        ) : (
                                            <span className="size-5" />
                                        )}
                                        <span className="flex-1">{opt.label}</span>
                                        <Check
                                            className={cn(
                                                'size-4',
                                                isSelected ? 'opacity-100' : 'opacity-0',
                                            )}
                                        />
                                    </CommandItem>
                                );
                            })}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
