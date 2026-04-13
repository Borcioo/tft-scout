import { Head } from '@inertiajs/react';
import { ShieldPlus } from 'lucide-react';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import AppLayout from '@/layouts/app-layout';

export default function PlansIndex() {
    return (
        <>
            <Head title="My Plans — TFT Scout" />

            <div className="flex flex-col gap-6 p-6">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">
                        My Plans
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        Your saved team compositions.
                    </p>
                </div>

                <Card>
                    <CardHeader>
                        <div className="flex size-10 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                            <ShieldPlus className="size-5" />
                        </div>
                        <CardTitle className="mt-2">Coming soon</CardTitle>
                        <CardDescription>
                            Save your favorite team compositions, edit slots,
                            and share them via a public URL. Integrates with
                            Scout so you can save any generated comp in one
                            click.
                        </CardDescription>
                    </CardHeader>
                    <CardContent />
                </Card>
            </div>
        </>
    );
}

PlansIndex.layout = (page: React.ReactNode) => (
    <AppLayout breadcrumbs={[{ title: 'My Plans', href: '/plans' }]}>
        {page}
    </AppLayout>
);
