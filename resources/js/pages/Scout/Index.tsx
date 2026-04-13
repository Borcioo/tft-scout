import { Head } from '@inertiajs/react';
import { useEffect, useState } from 'react';
import AppLayout from '@/layouts/app-layout';
import { useScoutWorker } from '@/hooks/use-scout-worker';
import type { ScoredTeam } from '@/workers/scout/types';

type Props = {
    setNumber: number;
};

export default function ScoutIndex({ setNumber }: Props) {
    const { generate } = useScoutWorker();
    const [results, setResults] = useState<ScoredTeam[]>([]);
    const [isRunning, setIsRunning] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setIsRunning(true);
        generate({ level: 8, topN: 10 })
            .then((out) => {
                if (!cancelled) {
                    setResults(out.results);
                    setIsRunning(false);
                }
            })
            .catch((err) => {
                if (!cancelled) {
                    setError(err.message);
                    setIsRunning(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [generate]);

    return (
        <>
            <Head title="Scout — TFT Scout" />
            <div className="flex flex-col gap-4 p-6">
                <h1 className="text-2xl font-bold">Scout (Set {setNumber})</h1>
                {isRunning && <p className="text-sm">Running scout…</p>}
                {error && <p className="text-sm text-red-500">{error}</p>}
                {!isRunning && !error && (
                    <p className="text-sm text-muted-foreground">
                        Got {results.length} results. UI comes in Phase D.
                    </p>
                )}
                <pre className="max-h-[60vh] overflow-auto rounded bg-muted p-3 text-xs">
                    {JSON.stringify(results.slice(0, 2), null, 2)}
                </pre>
            </div>
        </>
    );
}

ScoutIndex.layout = (page: React.ReactNode) => (
    <AppLayout breadcrumbs={[{ title: 'Scout', href: '/scout' }]}>
        {page}
    </AppLayout>
);
