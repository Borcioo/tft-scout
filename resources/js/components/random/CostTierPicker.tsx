import { cn } from '@/lib/utils';
import type { CostTier } from '@/lib/random-picker';

type Props = {
    value: CostTier;
    onChange: (value: CostTier) => void;
    disabled?: boolean;
};

const OPTIONS: { value: CostTier; label: string }[] = [
    { value: 'random', label: 'random' },
    { value: 2, label: '2' },
    { value: 3, label: '3' },
    { value: 4, label: '4' },
];

export function CostTierPicker({ value, onChange, disabled = false }: Props) {
    return (
        <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">Carry cost:</span>
            <div className="inline-flex rounded-lg border border-border bg-muted/40 p-1">
                {OPTIONS.map((opt) => {
                    const active = opt.value === value;
                    return (
                        <button
                            key={String(opt.value)}
                            type="button"
                            disabled={disabled}
                            onClick={() => onChange(opt.value)}
                            className={cn(
                                'rounded-md px-2.5 py-1 text-xs transition-colors',
                                active
                                    ? 'bg-background text-foreground shadow-sm'
                                    : 'text-muted-foreground hover:text-foreground',
                                disabled && 'cursor-not-allowed opacity-60',
                            )}
                        >
                            {opt.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
