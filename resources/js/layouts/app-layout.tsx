import { MetaSyncIndicator } from '@/components/MetaSyncIndicator';
import AppLayoutTemplate from '@/layouts/app/app-sidebar-layout';
import type { BreadcrumbItem } from '@/types';

type ScrollMode = 'page' | 'inset';

export default function AppLayout({
    breadcrumbs = [],
    children,
    /**
     * `page` (default): body scrolls naturally, content grows with height.
     * `inset`: viewport is pinned, children manage their own internal
     *   scroll (used by Scout which has 3-column fixed layout with an
     *   independently-scrolling results panel).
     */
    scrollMode = 'page',
}: {
    breadcrumbs?: BreadcrumbItem[];
    children: React.ReactNode;
    scrollMode?: ScrollMode;
}) {
    return (
        <AppLayoutTemplate breadcrumbs={breadcrumbs} scrollMode={scrollMode}>
            {children}
            <MetaSyncIndicator />
        </AppLayoutTemplate>
    );
}
