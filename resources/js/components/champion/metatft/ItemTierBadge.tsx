import { cn } from '@/lib/utils';

export type Tier = 'SS' | 'S' | 'A' | 'B' | 'C' | 'D';

/**
 * Tier color palette mirrors MetaTFT (observed from bundle inspection
 * 2026-04-16): SS red, S coral, A orange, B amber, C yellow, D lime.
 * Text is dark for legibility on the light backgrounds.
 */
const TIER_STYLES: Record<Tier, string> = {
    SS: 'bg-[#ff7e83] text-zinc-900',
    S: 'bg-[#ff9f80] text-zinc-900',
    A: 'bg-[#ffbf7f] text-zinc-900',
    B: 'bg-[#ffdf80] text-zinc-900',
    C: 'bg-[#feff7f] text-zinc-900',
    D: 'bg-[#bffe7f] text-zinc-900',
};

type Props = {
    tier: Tier | null;
    className?: string;
};

export function ItemTierBadge({ tier, className }: Props) {
    if (tier === null) {
        return (
            <span
                className={cn(
                    'inline-flex h-5 min-w-7 items-center justify-center rounded px-1 text-xs font-semibold text-muted-foreground',
                    className,
                )}
                title="Not enough games to rate"
            >
                —
            </span>
        );
    }

    return (
        <span
            className={cn(
                'inline-flex h-5 min-w-7 items-center justify-center rounded px-1 text-xs font-bold',
                TIER_STYLES[tier],
                className,
            )}
        >
            {tier}
        </span>
    );
}
