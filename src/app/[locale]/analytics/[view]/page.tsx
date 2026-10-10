import { notFound } from 'next/navigation';
import { readAnalyticsView } from '@/lib/analyticsView';
import { resolveRange } from '@/lib/analytics/range';
import { lastToastBusinessDates } from '@/lib/pos/toastBusinessDate';
import AnalyticsShell from '../AnalyticsShell';

/**
 * Analytics — one route, one dashboard per URL segment (resumen, ventas, …).
 *
 * The segment is checked against the allow-list in @/lib/analyticsView and an
 * unknown one is a 404, not a fallback: the sidebar only ever links to views
 * in that list, so anything else is a broken link that should look like one.
 *
 * The window (?from&to) is resolved here, on the server, and handed to the
 * client shell as its starting state. The shell then moves it with the
 * preset buttons and mirrors it back into the URL, so a reload or a shared
 * link opens on the same days. Reading the URL here rather than with
 * useSearchParams on the client keeps the page free of a Suspense boundary
 * requirement and of a flash of the default window before the real one.
 */
export default async function AnalyticsPage({
    params,
    searchParams
}: {
    params: Promise<{ locale: string; view: string }>;
    searchParams: Promise<{ from?: string | string[]; to?: string | string[] }>;
}) {
    const [{ locale, view: rawView }, { from, to }] = await Promise.all([params, searchParams]);
    const view = readAnalyticsView(rawView);
    if (!view) notFound();

    // Today in Toast's business day (4 AM cutover, New York), the same clock
    // the stored rows use.
    const today = lastToastBusinessDates(1)[0];
    const range = resolveRange(from, to, today);

    return <AnalyticsShell locale={locale} view={view} today={today} initialRange={range} />;
}
