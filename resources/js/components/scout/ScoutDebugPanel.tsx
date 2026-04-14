import { BugIcon, CheckIcon, CopyIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    Drawer,
    DrawerClose,
    DrawerContent,
    DrawerDescription,
    DrawerFooter,
    DrawerHeader,
    DrawerTitle,
    DrawerTrigger,
} from '@/components/ui/drawer';
import type { ScoredTeam } from '@/workers/scout/types';

type EmblemEntry = { apiName: string; count: number };
type LockedTrait = { apiName: string; minUnits: number };

export type ScoutDebugParams = {
    level: number;
    topN: number;
    max5Cost: number | null;
    roleBalance: boolean;
    minFrontline: number;
    minDps: number;
    lockedChampions: string[];
    lockedTraits: LockedTrait[];
    emblems: EmblemEntry[];
};

type Props = {
    params: ScoutDebugParams;
    results: ScoredTeam[];
};

/**
 * Build a scout-cli command from the current UI state so the debug
 * report pastes back into `npm run scout -- generate ...` verbatim.
 * Any flag that's at its default is omitted to keep the line short.
 */
function buildCliCommand(params: ScoutDebugParams): string {
    const parts: string[] = ['npm run scout -- generate'];

    parts.push(`--top-n ${params.topN}`);

    if (params.level !== 8) {
        parts.push(`--level ${params.level}`);
    }

    if (params.max5Cost != null) {
        parts.push(`--max-5cost ${params.max5Cost}`);
    }

    if (params.minFrontline > 0) {
        parts.push(`--min-frontline ${params.minFrontline}`);
    }

    if (params.minDps > 0) {
        parts.push(`--min-dps ${params.minDps}`);
    }

    if (params.lockedChampions.length > 0) {
        parts.push(`--locked ${params.lockedChampions.join(',')}`);
    }

    for (const t of params.lockedTraits) {
        parts.push(`--locked-trait ${t.apiName}:${t.minUnits}`);
    }

    for (const e of params.emblems) {
        parts.push(`--emblem ${e.apiName}:${e.count}`);
    }

    return parts.join(' ');
}

/**
 * Debug panel for manual Scout testing. Dumps current filter state and
 * top results as a JSON blob + paste-ready CLI command so a human can
 * copy the exact repro into an assistant chat without retyping.
 */
export function ScoutDebugPanel({ params, results }: Props) {
    const [copied, setCopied] = useState<'json' | 'cli' | null>(null);

    const payload = useMemo(() => {
        const compacted = results.slice(0, 5).map((r, idx) => ({
            rank: idx + 1,
            score: r.score,
            slotsUsed: r.slotsUsed,
            champions: r.champions.map((c) => c.apiName),
            roles: r.roles ?? null,
            activeTraits: (r.activeTraits ?? []).map((t) => ({
                apiName: t.apiName,
                count: t.count,
                style: t.style ?? null,
            })),
            breakdown: r.breakdown ?? null,
            metaMatch: r.metaMatch ?? null,
        }));

        return {
            capturedAt: new Date().toISOString(),
            url: typeof window !== 'undefined' ? window.location.href : null,
            params,
            resultCount: results.length,
            topResults: compacted,
        };
    }, [params, results]);

    const jsonString = useMemo(() => JSON.stringify(payload, null, 2), [payload]);
    const cliCommand = useMemo(() => buildCliCommand(params), [params]);

    const handleCopy = async (value: string, kind: 'json' | 'cli') => {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(kind);
            setTimeout(() => setCopied(null), 1500);
        } catch {
            setCopied(null);
        }
    };

    return (
        <Drawer>
            <DrawerTrigger asChild>
                <button
                    type="button"
                    className="fixed right-6 bottom-6 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-lg transition hover:bg-accent hover:text-foreground"
                    aria-label="Open Scout debug panel"
                >
                    <BugIcon className="h-5 w-5" />
                </button>
            </DrawerTrigger>
            <DrawerContent className="max-h-[85vh]">
                <div className="mx-auto w-full max-w-3xl">
                    <DrawerHeader>
                        <DrawerTitle>Scout debug snapshot</DrawerTitle>
                        <DrawerDescription>
                            Current filters + top 5 results. Copy either block and paste into a chat to get help on the exact state you&apos;re seeing.
                        </DrawerDescription>
                    </DrawerHeader>

                    <div className="space-y-4 px-4 pb-2">
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-semibold uppercase text-muted-foreground">
                                    scout-cli command
                                </label>
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => handleCopy(cliCommand, 'cli')}
                                >
                                    {copied === 'cli' ? (
                                        <CheckIcon className="h-4 w-4" />
                                    ) : (
                                        <CopyIcon className="h-4 w-4" />
                                    )}
                                    {copied === 'cli' ? 'Copied' : 'Copy'}
                                </Button>
                            </div>
                            <pre className="max-h-24 overflow-auto rounded border border-border bg-muted px-3 py-2 font-mono text-xs break-all whitespace-pre-wrap">
                                {cliCommand}
                            </pre>
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <label className="text-xs font-semibold uppercase text-muted-foreground">
                                    full JSON snapshot
                                </label>
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => handleCopy(jsonString, 'json')}
                                >
                                    {copied === 'json' ? (
                                        <CheckIcon className="h-4 w-4" />
                                    ) : (
                                        <CopyIcon className="h-4 w-4" />
                                    )}
                                    {copied === 'json' ? 'Copied' : 'Copy'}
                                </Button>
                            </div>
                            <pre className="max-h-[50vh] overflow-auto rounded border border-border bg-muted px-3 py-2 font-mono text-xs whitespace-pre">
                                {jsonString}
                            </pre>
                        </div>
                    </div>

                    <DrawerFooter>
                        <DrawerClose asChild>
                            <Button variant="outline">Close</Button>
                        </DrawerClose>
                    </DrawerFooter>
                </div>
            </DrawerContent>
        </Drawer>
    );
}
