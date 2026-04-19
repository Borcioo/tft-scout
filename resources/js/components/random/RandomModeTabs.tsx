import { cn } from '@/lib/utils';

export type RandomMode = 'full' | 'carry' | 'trait';

type Props = {
    mode: RandomMode;
    onChange: (mode: RandomMode) => void;
    disabled?: boolean;
};

const OPTIONS: { value: RandomMode; label: string; hint: string }[] = [
    { value: 'full', label: 'Full random', hint: 'Losowy team z puli' },
    { value: 'carry', label: 'Carry seed', hint: 'Losowy carry + scout wokół niego' },
    { value: 'trait', label: 'Trait seed', hint: 'Losowy trait + scout wokół niego' },
];

export function RandomModeTabs({ mode, onChange, disabled = false }: Props) {
    return (
        <div
            role="tablist"
            aria-label="Tryb losowania"
            className="inline-flex rounded-lg border border-border bg-muted/40 p-1"
        >
            {OPTIONS.map((opt) => {
                const active = opt.value === mode;
                return (
                    <button
                        key={opt.value}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        title={opt.hint}
                        disabled={disabled}
                        onClick={() => onChange(opt.value)}
                        className={cn(
                            'rounded-md px-3 py-1.5 text-sm transition-colors',
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
    );
}
