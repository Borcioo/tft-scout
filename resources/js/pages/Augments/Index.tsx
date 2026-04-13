import { Head } from '@inertiajs/react';
import { Sparkles } from 'lucide-react';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import AppLayout from '@/layouts/app-layout';

export default function AugmentsIndex() {
    return (
        <>
            <Head title="Augments — TFT Scout" />

            <div className="flex flex-col gap-6 p-6">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">
                        Augments
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        All augments grouped by tier, with trait-gated
                        requirements.
                    </p>
                </div>

                <Card>
                    <CardHeader>
                        <div className="flex size-10 items-center justify-center rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-400">
                            <Sparkles className="size-5" />
                        </div>
                        <CardTitle className="mt-2">Coming soon</CardTitle>
                        <CardDescription>
                            Augment browser with silver/gold/prismatic tiers,
                            hero augments, and filtering by associated trait.
                        </CardDescription>
                    </CardHeader>
                    <CardContent />
                </Card>
            </div>
        </>
    );
}

AugmentsIndex.layout = (page: React.ReactNode) => (
    <AppLayout
        breadcrumbs={[
            { title: 'Browse', href: '#' },
            { title: 'Augments', href: '/augments' },
        ]}
    >
        {page}
    </AppLayout>
);
