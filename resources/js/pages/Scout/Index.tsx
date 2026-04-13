import { Head } from '@inertiajs/react';
import AppLayout from '@/layouts/app-layout';

type Props = {
    setNumber: number;
};

export default function ScoutIndex({ setNumber }: Props) {
    return (
        <>
            <Head title="Scout — TFT Scout" />
            <div className="p-6">
                <h1 className="text-2xl font-bold">Scout (Set {setNumber})</h1>
                <p className="text-sm text-muted-foreground">
                    Worker + UI not wired yet — see Task C1 onwards.
                </p>
            </div>
        </>
    );
}

ScoutIndex.layout = (page: React.ReactNode) => (
    <AppLayout
        breadcrumbs={[
            { title: 'Scout', href: '/scout' },
        ]}
    >
        {page}
    </AppLayout>
);
