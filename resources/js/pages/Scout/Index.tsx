import { Head } from '@inertiajs/react';
import { Crosshair } from 'lucide-react';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import AppLayout from '@/layouts/app-layout';

export default function ScoutIndex() {
    return (
        <>
            <Head title="Scout — TFT Scout" />

            <div className="flex flex-col gap-6 p-6">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">
                        Scout
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        Find optimal compositions around your locked champions.
                    </p>
                </div>

                <Card>
                    <CardHeader>
                        <div className="flex size-10 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400">
                            <Crosshair className="size-5" />
                        </div>
                        <CardTitle className="mt-2">
                            Coming soon
                        </CardTitle>
                        <CardDescription>
                            Scout algorithm is being ported from the previous
                            version. This page will let you lock champions,
                            filter traits, and scan for the best composition
                            matching your constraints — all computed locally
                            in your browser via Web Workers.
                        </CardDescription>
                    </CardHeader>
                    <CardContent />
                </Card>
            </div>
        </>
    );
}

ScoutIndex.layout = (page: React.ReactNode) => (
    <AppLayout breadcrumbs={[{ title: 'Scout', href: '/scout' }]}>
        {page}
    </AppLayout>
);
