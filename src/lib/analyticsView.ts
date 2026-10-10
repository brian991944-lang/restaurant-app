/**
 * The Analytics section's dashboards, as they are written in the URL
 * (/analytics/resumen, /analytics/ventas, …).
 *
 * No 'use client' directive here, for the reason lib/reportsTab.ts spells
 * out: the server page calls readAnalyticsView to decide what to render, and
 * the client Sidebar maps over ANALYTICS_VIEWS to build the dropdown. A module
 * with no directive is the only kind both sides may import.
 *
 * A dashboard exists here only once it has something real to show: the
 * sidebar lists exactly this array, so a view cannot be linked before it is
 * built. Later passes add to it (platos, personal, reputacion, resultados),
 * each with its page component in src/app/[locale]/analytics.
 */

export type AnalyticsView = 'resumen' | 'ventas' | 'cobros';

/** Every dashboard, in the order the sidebar dropdown shows them. */
export const ANALYTICS_VIEWS = ['resumen', 'ventas', 'cobros'] as const;

/** The overview is the section's entry point. */
export const DEFAULT_ANALYTICS_VIEW: AnalyticsView = 'resumen';

/** The URL segment under /[locale]. The sidebar and the redirect from /sales build on it. */
export const ANALYTICS_SEGMENT = 'analytics';

/**
 * Which dashboard a URL segment addresses, or null for one that does not
 * exist — the page answers that with notFound() rather than a silent fallback,
 * because a mistyped dashboard is a broken link, not a request for the default.
 */
export function readAnalyticsView(raw: string | string[] | undefined): AnalyticsView | null {
    const value = Array.isArray(raw) ? raw[0] : raw;
    return ANALYTICS_VIEWS.includes(value as AnalyticsView) ? (value as AnalyticsView) : null;
}

/** '/es/analytics/ventas' — one place builds these so the sidebar and the redirect cannot drift. */
export function analyticsHref(locale: string, view: AnalyticsView): string {
    return `/${locale}/${ANALYTICS_SEGMENT}/${view}`;
}
