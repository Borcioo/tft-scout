import type { LockIssue, ScoredTeam } from '@/workers/scout/types';
import type { ItemBuildsMap } from './ChampionItemBuildsAccordion';
import { ScoutCompCard } from './ScoutCompCard';
import { TraitLockIssues } from './TraitLockIssues';

type EmblemEntry = { apiName: string; count: number };

type Props = {
    teams: ScoredTeam[];
    isRunning: boolean;
    error: string | null;
    itemBuilds: ItemBuildsMap;
    savedCodes: Set<string>;
    onSaved: (code: string) => void;
    level: number;
    emblems: EmblemEntry[];
    lockIssues: LockIssue[];
    onLockChampion: (apiName: string) => void;
};

export function ScoutResultsList({
    teams,
    isRunning,
    error,
    itemBuilds,
    savedCodes,
    onSaved,
    level,
    emblems,
    lockIssues,
    onLockChampion,
}: Props) {
    if (error) {
        return (
            <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-800 text-sm dark:border-red-800/60 dark:bg-red-950/20 dark:text-red-300">
                Scout failed: {error}
            </div>
        );
    }

    if (isRunning && teams.length === 0) {
        return (
            <div className="flex h-40 items-center justify-center text-muted-foreground text-sm">
                Running scout…
            </div>
        );
    }

    if (teams.length === 0 && lockIssues.length > 0) {
        return (
            <TraitLockIssues
                issues={lockIssues}
                level={level}
                onLockChampion={onLockChampion}
            />
        );
    }

    if (teams.length === 0) {
        return (
            <div className="flex h-40 items-center justify-center text-muted-foreground text-sm">
                No comps yet. Adjust settings and click "Run scout".
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4">
            {teams.map((team) => (
                <ScoutCompCard
                    key={team.champions.map((c) => c.apiName).join(',')}
                    team={team}
                    itemBuilds={itemBuilds}
                    savedCodes={savedCodes}
                    onSaved={onSaved}
                    level={level}
                    emblems={emblems}
                />
            ))}
        </div>
    );
}
