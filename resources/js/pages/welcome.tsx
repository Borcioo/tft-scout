import { Head, Link, usePage } from '@inertiajs/react';
import {
    Crosshair,
    ShieldPlus,
    Sparkles,
    Target,
    Users,
} from 'lucide-react';
import AppLayout from '@/layouts/app-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { login, register } from '@/routes';
import type { BreadcrumbItem } from '@/types';

const breadcrumbs: BreadcrumbItem[] = [{ title: 'Home', href: '/' }];

type WelcomeProps = {
    canRegister?: boolean;
};

export default function Welcome({ canRegister = true }: WelcomeProps) {
    const { auth } = usePage().props;

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title="TFT Scout — Comp Builder & Planner" />

            <div className="flex flex-col gap-10 p-6 md:p-10">
                {/* ── Hero ────────────────────────────── */}
                <section className="flex flex-col items-start gap-6 rounded-xl border bg-gradient-to-br from-amber-50/60 via-orange-50/40 to-background p-10 dark:from-amber-950/20 dark:via-orange-950/10 dark:to-background">
                    <Badge variant="secondary" className="gap-1.5">
                        <Sparkles className="size-3" />
                        Set 17 — Into the Arcane
                    </Badge>

                    <div className="flex flex-col gap-3">
                        <h1 className="text-4xl font-bold tracking-tight md:text-5xl">
                            Build the perfect TFT comp,{' '}
                            <span className="bg-gradient-to-r from-amber-500 to-orange-600 bg-clip-text text-transparent">
                                powered by real data.
                            </span>
                        </h1>
                        <p className="max-w-2xl text-lg text-muted-foreground">
                            Scout scans thousands of high-elo games to find the
                            optimal composition for any locked champion or
                            trait combo. Browse the full roster, save your
                            favorite builds, and share plans with friends.
                        </p>
                    </div>

                    <div className="flex flex-wrap gap-3">
                        <Button asChild size="lg">
                            <Link href="/scout">
                                <Crosshair className="mr-2 size-4" />
                                Start scouting
                            </Link>
                        </Button>
                        <Button asChild size="lg" variant="outline">
                            <Link href="/champions">
                                <Users className="mr-2 size-4" />
                                Browse champions
                            </Link>
                        </Button>
                        {!auth.user && canRegister && (
                            <Button asChild size="lg" variant="ghost">
                                <Link href={register()}>Create free account</Link>
                            </Button>
                        )}
                    </div>
                </section>

                {/* ── Features ────────────────────────── */}
                <section className="grid gap-4 md:grid-cols-3">
                    <FeatureCard
                        icon={Target}
                        title="Scout Algorithm"
                        description="Graph-based beam search finds comps that maximize trait synergies around your locked champions."
                    />
                    <FeatureCard
                        icon={Users}
                        title="Full Roster"
                        description="Browse every champion with stats, traits, and ability details straight from the game data."
                    />
                    <FeatureCard
                        icon={ShieldPlus}
                        title="Saved Plans"
                        description="Save your favorite builds, share them via URL, and come back to iterate patch after patch."
                    />
                </section>

                {/* ── Footer note ─────────────────────── */}
                <section className="flex flex-wrap items-center justify-between gap-3 border-t pt-6 text-sm text-muted-foreground">
                    <p>
                        Data from{' '}
                        <a
                            href="https://www.communitydragon.org/"
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-foreground hover:underline"
                        >
                            CommunityDragon
                        </a>
                        . Not affiliated with Riot Games.
                    </p>
                    {auth.user ? (
                        <span>
                            Signed in as{' '}
                            <span className="font-medium text-foreground">
                                {auth.user.name}
                            </span>
                        </span>
                    ) : (
                        <div className="flex gap-4">
                            <Link
                                href={login()}
                                className="hover:text-foreground"
                            >
                                Log in
                            </Link>
                            {canRegister && (
                                <Link
                                    href={register()}
                                    className="hover:text-foreground"
                                >
                                    Sign up
                                </Link>
                            )}
                        </div>
                    )}
                </section>
            </div>
        </AppLayout>
    );
}

function FeatureCard({
    icon: Icon,
    title,
    description,
}: {
    icon: React.ComponentType<{ className?: string }>;
    title: string;
    description: string;
}) {
    return (
        <Card>
            <CardHeader>
                <div className="flex aspect-square size-10 items-center justify-center rounded-md bg-gradient-to-br from-amber-500/20 to-orange-600/20 text-amber-600 dark:text-amber-400">
                    <Icon className="size-5" />
                </div>
                <CardTitle className="mt-2">{title}</CardTitle>
                <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent />
        </Card>
    );
}
