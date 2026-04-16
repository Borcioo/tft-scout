import { ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils';

type Props = {
    /** Delta in avg_place vs previous snapshot. NEGATIVE = better in TFT. */
    value: number | null;
    className?: string;
};

/**
 * Renders `+0.42` / `-0.30` with color + arrow.
 *
 * In TFT lower avg_place = better, so the sign convention is inverted:
 *   negative value → GREEN (improvement), arrow down
 *   positive value → RED (regression), arrow up
 *
 * Null → em-dash muted (no comparison available yet — data from first sync).
 */
export function PlaceChangeBadge({ value, className }: Props) {
    if (value === null || Number.isNaN(value)) {
        return (
            <span className={cn('text-sm text-muted-foreground', className)}>
                —
            </span>
        );
    }

    if (Math.abs(value) < 0.005) {
        return (
            <span className={cn('text-sm text-muted-foreground', className)}>
                ±0.00
            </span>
        );
    }

    const isImprovement = value < 0;
    const Arrow = isImprovement ? ArrowDown : ArrowUp;
    const color = isImprovement ? 'text-emerald-400' : 'text-rose-400';
    const sign = value > 0 ? '+' : '';

    return (
        <span className={cn('inline-flex items-center gap-0.5 text-sm font-medium', color, className)}>
            <Arrow className="size-3" strokeWidth={2.5} />
            {sign}
            {value.toFixed(2)}
        </span>
    );
}
