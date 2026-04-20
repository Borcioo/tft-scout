import { Link, usePage } from '@inertiajs/react';
import {
    Crosshair,
    Dices,
    Radar,
    Shapes,
    ShieldPlus,
    Sparkles,
    Swords,
    Users,
} from 'lucide-react';
import AppLogo from '@/components/app-logo';
import { NavMain } from '@/components/nav-main';
import { NavUser } from '@/components/nav-user';
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from '@/components/ui/sidebar';
import type { NavItem } from '@/types';

/**
 * Sidebar navigation groups for TFT Scout.
 *
 * "Scout" group — active workflow (building comps, managing saved plans).
 * "Browse" group — read-only data browsers (reference tables from CDragon).
 *
 * Admin dashboard and settings intentionally NOT in main nav — they live
 * under the user menu (NavUser) and will be expanded for premium features later.
 */
const scoutNavItems: NavItem[] = [
    {
        title: 'Scout',
        href: '/scout',
        icon: Crosshair,
    },
    {
        title: 'Random',
        href: '/random',
        icon: Dices,
    },
];

// My Plans is auth-only — hidden from sidebar for guests since the
// route is behind auth middleware anyway and the CTA would 302 them
// to login.
const scoutAuthedNavItems: NavItem[] = [
    {
        title: 'My Plans',
        href: '/plans',
        icon: ShieldPlus,
    },
];

const browseNavItems: NavItem[] = [
    {
        title: 'Scout',
        href: '/scout',
        icon: Radar,
    },
    {
        title: 'Champions',
        href: '/champions',
        icon: Users,
    },
    {
        title: 'Traits',
        href: '/traits',
        icon: Shapes,
    },
    {
        title: 'Items',
        href: '/items',
        icon: Swords,
    },
    {
        title: 'Augments',
        href: '/augments',
        icon: Sparkles,
    },
];

export function AppSidebar() {
    const { auth } = usePage<{ auth: { user: { id: number } | null } }>().props;
    const isAuthed = !!auth?.user;

    const scoutItems = isAuthed
        ? [...scoutNavItems, ...scoutAuthedNavItems]
        : scoutNavItems;

    return (
        <Sidebar collapsible="icon" variant="inset">
            <SidebarHeader>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton size="lg" asChild>
                            <Link href="/" prefetch>
                                <AppLogo />
                            </Link>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
            </SidebarHeader>

            <SidebarContent>
                <NavMain items={scoutItems} label="Scout" />
                <NavMain items={browseNavItems} label="Browse" />
            </SidebarContent>

            <SidebarFooter>
                <NavUser />
            </SidebarFooter>
        </Sidebar>
    );
}
