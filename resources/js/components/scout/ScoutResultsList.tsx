import type { ScoredTeam } from '@/workers/scout/types';
import { ScoutCompCard } from './ScoutCompCard';

type Props = {
    teams: ScoredTeam[];
    isRunning: boolean;
    error: string | null;
};

export function ScoutResultsList({ teams, isRunning, error }: Props) {
    if (error) {
        return (
            <div className="rounded-lg border border-red-800/60 bg-red-950/20 p-4 text-sm text-red-300">
                Scout failed: {error}
            </div>
        );
    }

    if (isRunning && teams.length === 0) {
        return (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                Running scout…
            </div>
        );
    }

    if (teams.length === 0) {
        return (
            <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                No comps yet. Adjust settings and click "Run scout".
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-4">
            {teams.map((team, i) => (
                <ScoutCompCard key={i} team={team} />
            ))}
        </div>
    );
}
