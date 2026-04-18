import { AppContent } from '@/components/app-content';
import { AppShell } from '@/components/app-shell';
import { AppSidebar } from '@/components/app-sidebar';
import { AppSidebarHeader } from '@/components/app-sidebar-header';
import type { AppLayoutProps } from '@/types';

type Props = AppLayoutProps & {
    scrollMode?: 'page' | 'inset';
};

export default function AppSidebarLayout({
    children,
    breadcrumbs = [],
    scrollMode = 'page',
}: Props) {
    // `inset` pins the viewport (overflow-hidden) for pages that manage
    // their own internal scroll (Scout). `page` lets the browser handle
    // body scroll naturally — default for every browse page so long
    // tables/grids (Champions, Plans) scroll as users expect.
    const insetClass = scrollMode === 'inset' ? 'overflow-hidden' : '';

    return (
        <AppShell variant="sidebar">
            <AppSidebar />
            <AppContent variant="sidebar" className={insetClass}>
                <AppSidebarHeader breadcrumbs={breadcrumbs} />
                {children}
            </AppContent>
        </AppShell>
    );
}
