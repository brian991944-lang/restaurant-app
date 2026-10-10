import { redirect } from 'next/navigation';
import { analyticsHref, DEFAULT_ANALYTICS_VIEW } from '@/lib/analyticsView';

/** /analytics on its own opens the overview; every dashboard lives one segment deeper. */
export default async function AnalyticsIndex({ params }: { params: Promise<{ locale: string }> }) {
    const { locale } = await params;
    redirect(analyticsHref(locale, DEFAULT_ANALYTICS_VIEW));
}
