import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { ScoredTeam } from '@/workers/scout/types';

import { WhyThisComp } from './WhyThisComp';

const COST_BORDER: Record<number, string> = {
    1: 'border-zinc-500',
    2: 'border-green-500',
    3: 'border-blue-500',
    4: 'border-purple-500',
    5: 'border-yellow-500',
};

const STYLE_CHIP: Record<string, string> = {
    Bronze: 'border-amber-700 bg-amber-950/40 text-amber-400',
    Silver: 'border-zinc-400 bg-zinc-800/60 text-zinc-200',
    Gold: 'border-yellow-500 bg-yellow-950/40 text-yellow-300',
    Prismatic: 'border-fuchsia-400 bg-fuchsia-950/40 text-fuchsia-300',
    Unique: 'border-red-500 bg-red-950/40 text-red-300',
};

type Props = {
    team: ScoredTeam;
};

export function ScoutCompCard({ team }: Props) {
    return (
        <Card className="flex flex-col gap-3 p-4">
            <div className="flex items-baseline justify-between">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">
                    Score
                </span>
                <span className="font-mono text-lg font-bold text-amber-300">
                    {team.score.toFixed(1)}
                </span>
            </div>

            <div className="flex flex-wrap gap-1.5">
                {team.champions.map((c) => (
                    <div
                        key={c.apiName}
                        className={cn(
                            'flex size-12 items-center justify-center overflow-hidden rounded border-2 bg-muted',
                            COST_BORDER[c.cost] ?? 'border-zinc-500',
                        )}
                        title={c.name}
                    >
                        <img
                            src={c.icon}
                            alt={c.name}
                            className="size-full object-cover"
                            loading="lazy"
                        />
                    </div>
                ))}
            </div>

            <div className="flex flex-wrap gap-1">
                {team.activeTraits.map((t) => {
                    const style = t.style ?? 'Bronze';
                    return (
                        <Badge
                            key={t.apiName}
                            variant="outline"
                            className={cn(
                                'gap-1 text-[10px]',
                                STYLE_CHIP[style] ?? '',
                            )}
                        >
                            {t.icon && (
                                <img
                                    src={t.icon}
                                    alt=""
                                    className="size-3"
                                />
                            )}
                            {t.count} {t.name}
                        </Badge>
                    );
                })}
            </div>

            <WhyThisComp insights={team.insights} />
        </Card>
    );
}
