import { cn } from '@/lib/utils';

type Props = {
    variant: string | null | undefined;
    /** `sm` = 10×10px (comp card chip), `md` = 14×14px (larger tiles). */
    size?: 'sm' | 'md';
    className?: string;
};

/**
 * Small corner badge on champion icons telling the user at a glance
 * whether this is the base unit, a Mecha enhanced form, or a hero
 * variant. Positioned absolute top-right — the parent element must be
 * `relative`.
 *
 * Returns null for regular champions so callers can unconditionally
 * render <ChampionVariantBadge variant={c.variant} /> without branching.
 */
export function ChampionVariantBadge({ variant, size = 'sm', className }: Props) {
    if (variant !== 'enhanced' && variant !== 'hero') {
        return null;
    }

    const isEnhanced = variant === 'enhanced';
    const label = isEnhanced ? 'E' : 'H';
    const title = isEnhanced ? 'Enhanced variant' : 'Hero variant';

    const dimClass = size === 'md'
        ? 'h-[14px] min-w-[14px] text-[9px]'
        : 'h-[10px] min-w-[10px] text-[7px]';

    return (
        <span
            title={title}
            className={cn(
                'absolute right-0 top-0 flex items-center justify-center rounded-bl-sm rounded-tr-sm px-[2px] font-bold leading-none ring-1 ring-black/30',
                isEnhanced
                    ? 'bg-emerald-500 text-emerald-950'
                    : 'bg-amber-400 text-amber-950',
                dimClass,
                className,
            )}
        >
            {label}
        </span>
    );
}
