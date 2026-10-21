import { cn } from '@/lib/utils';

type Props = {
    /** 1..3 parallel arrays; icons are served from /icons/items/{apiName}.png */
    apiNames: string[];
    names: string[];
    size?: 'sm' | 'md';
    className?: string;
};

/**
 * Row of 1-3 item icons side-by-side. Missing icon (onError) is hidden
 * so the row collapses gracefully — matches pattern used elsewhere in
 * Show.tsx for splash/trait icons.
 */
export function ItemIconStack({
    apiNames,
    names,
    size = 'md',
    className,
}: Props) {
    const dim = size === 'sm' ? 'size-6' : 'size-8';

    return (
        <div className={cn('flex items-center gap-1', className)}>
            {apiNames.map((api, i) => (
                <img
                    // Same item can sit in two slots; position is the identity
                    // biome-ignore lint/suspicious/noArrayIndexKey: fixed ≤3-slot build, never reordered
                    key={`${api}-${i}`}
                    src={`/icons/items/${api}.png`}
                    alt={names[i] ?? api}
                    title={names[i] ?? api}
                    className={cn(
                        dim,
                        'rounded border border-border/60 object-cover',
                    )}
                    onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                    }}
                />
            ))}
        </div>
    );
}
