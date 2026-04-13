import { Target } from 'lucide-react';

/**
 * TFT Scout brand logo for the sidebar header.
 * Uses Lucide Target icon (crosshair) to evoke "scouting" / targeting composition.
 */
export default function AppLogo() {
    return (
        <>
            <div className="flex aspect-square size-8 items-center justify-center rounded-md bg-gradient-to-br from-amber-500 to-orange-600 text-white">
                <Target className="size-5" strokeWidth={2.5} />
            </div>
            <div className="ml-1 grid flex-1 text-left text-sm">
                <span className="truncate leading-tight font-semibold">
                    TFT Scout
                </span>
                <span className="truncate text-[10px] text-muted-foreground leading-tight">
                    Comp builder & planner
                </span>
            </div>
        </>
    );
}
