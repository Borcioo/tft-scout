import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { LockIssue } from '@/workers/scout/types';

type Props = {
    issues: LockIssue[];
    level: number;
    onLockChampion: (apiName: string) => void;
};

/**
 * Empty-slate explanation for trait locks the scout cannot reach. The
 * level gate keeps rare units out (5-costs before level 9), but a player
 * who already hit one can lock it — the button does exactly that.
 */
export function TraitLockIssues({ issues, level, onLockChampion }: Props) {
    return (
        <div className="flex flex-col gap-3">
            {issues.map((issue) => {
                const label = `${issue.traitName} ${issue.minUnits}`;
                const unlockable =
                    issue.gatedUnits.length > 0 &&
                    issue.reachIgnoringLevel >= issue.minUnits;

                return (
                    <div
                        key={issue.traitApiName}
                        className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900 text-sm dark:border-amber-800/60 dark:bg-amber-950/20 dark:text-amber-200"
                    >
                        {unlockable ? (
                            <>
                                <p>
                                    <strong>{label}</strong> is out of reach at
                                    level {level} (best case {issue.reach}). It
                                    needs {issue.minUnits - issue.reach} more
                                    from units the scout only fields at a higher
                                    level — lock the ones you already have.
                                </p>
                                <div className="mt-3 flex flex-wrap gap-2">
                                    {issue.gatedUnits.map((unit) => (
                                        <Button
                                            key={unit.apiName}
                                            size="sm"
                                            variant="outline"
                                            onClick={() =>
                                                onLockChampion(unit.apiName)
                                            }
                                        >
                                            <Lock className="size-3.5" />
                                            {unit.name} · {unit.cost}-cost
                                            {unit.amount > 1
                                                ? ` · counts ${unit.amount}`
                                                : ''}{' '}
                                            · level {unit.fromLevel}+
                                        </Button>
                                    ))}
                                </div>
                            </>
                        ) : (
                            <p>
                                <strong>{label}</strong> can't be reached — at
                                most {issue.reachIgnoringLevel} with the current
                                champions, bans and emblems.
                            </p>
                        )}
                    </div>
                );
            })}
        </div>
    );
}
