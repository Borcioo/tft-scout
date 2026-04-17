import { usePage } from '@inertiajs/react';
import { Check, Copy, Star } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { generatePlannerCode } from '@/lib/plannerCode';
import { cn } from '@/lib/utils';
import type { ScoredTeam } from '@/workers/scout/types';

import { type ItemBuildsMap } from './ChampionItemBuildsAccordion';
import { buildPlanName, CompCardBody } from './CompCardBody';

function getCsrfToken(): string {
    return (
        document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? ''
    );
}

type EmblemEntry = { apiName: string; count: number };

type Props = {
    team: ScoredTeam;
    itemBuilds: ItemBuildsMap;
    savedCodes: Set<string>;
    onSaved: (code: string) => void;
    /** Scout parameters used to produce this team — captured at save time
     *  so live recompute on Plans page uses the same context. */
    level: number;
    emblems: EmblemEntry[];
};

/** Flatten EmblemEntry[] → apiName[] (engine expects one string per instance). */
function flattenEmblems(emblems: EmblemEntry[]): string[] {
    const out: string[] = [];
    for (const e of emblems) {
        const count = Math.max(1, e.count | 0);
        for (let i = 0; i < count; i++) out.push(e.apiName);
    }
    return out;
}

export function ScoutCompCard({
    team,
    itemBuilds,
    savedCodes,
    onSaved,
    level,
    emblems,
}: Props) {
    const { auth } = usePage<{ auth: { user: { id: number } | null } }>().props;
    const isAuthed = !!auth?.user;

    const [copied, setCopied] = useState(false);
    const [saving, setSaving] = useState(false);
    const plannerCode = generatePlannerCode(team.champions);
    const isSaved = plannerCode != null && savedCodes.has(plannerCode);

    const handleCopy = async () => {
        if (!plannerCode) return;
        try {
            await navigator.clipboard.writeText(plannerCode);
            setCopied(true);
            toast.success('Team code copied — paste in TFT Team Planner');
            setTimeout(() => setCopied(false), 1500);
        } catch {
            toast.error('Copy failed');
        }
    };

    const handleSave = async () => {
        if (saving || isSaved) return;
        setSaving(true);
        try {
            const res = await fetch('/api/plans', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-TOKEN': getCsrfToken(),
                    Accept: 'application/json',
                    'X-Requested-With': 'XMLHttpRequest',
                },
                credentials: 'same-origin',
                body: JSON.stringify({
                    name: buildPlanName(team),
                    champions: team.champions.map((c) => c.apiName),
                    meta: {
                        score: team.score,
                        activeTraits: team.activeTraits,
                        roles: team.roles,
                        insights: team.insights,
                        metaMatch: team.metaMatch,
                        // Params needed to reproduce score on Plans page.
                        params: {
                            level,
                            emblems: flattenEmblems(emblems),
                        },
                    },
                }),
            });

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }

            const json = (await res.json()) as {
                plannerCode: string | null;
                alreadySaved: boolean;
            };
            if (json.plannerCode) {
                onSaved(json.plannerCode);
            }
            toast.success(
                json.alreadySaved ? 'Already in My Plans' : 'Saved to My Plans',
            );
        } catch (e) {
            toast.error('Save failed');
            console.error(e);
        } finally {
            setSaving(false);
        }
    };

    return (
        <CompCardBody
            team={team}
            itemBuilds={itemBuilds}
            headerRight={
                <>
                    {plannerCode && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleCopy}
                            className="h-7 gap-1.5 text-xs"
                            title="Copy TFT Team Planner code"
                        >
                            {copied ? (
                                <Check className="size-3.5 text-emerald-400" />
                            ) : (
                                <Copy className="size-3.5" />
                            )}
                            {copied ? 'Copied' : 'Copy code'}
                        </Button>
                    )}
                    {isAuthed && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleSave}
                            disabled={saving || isSaved}
                            className={cn(
                                'h-7 gap-1.5 text-xs',
                                isSaved && 'border-amber-500/60 bg-amber-950/30',
                            )}
                            title={
                                isSaved
                                    ? 'Already saved in My Plans'
                                    : 'Save to My Plans'
                            }
                        >
                            <Star
                                className={cn(
                                    'size-3.5',
                                    isSaved && 'fill-amber-400 text-amber-400',
                                )}
                            />
                            {isSaved ? 'Saved' : saving ? 'Saving…' : 'Save'}
                        </Button>
                    )}
                </>
            }
        />
    );
}
