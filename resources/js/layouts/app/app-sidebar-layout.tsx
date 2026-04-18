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
    // AppShell wrapper has `h-svh overflow-hidden` unconditionally
    // (shadcn sidebar primitive), so the SidebarInset (AppContent) is
    // where scroll actually lives.
    //   - `page` → overflow-y-auto so long lists/grids scroll naturally
    //   - `inset` → overflow-hidden; Scout handles scroll in its own
    //     3-column internal layout
    const insetClass = scrollMode === 'inset'
        ? 'overflow-hidden'
        : 'overflow-y-auto';

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
