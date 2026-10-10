'use server';

import { isAdminSession } from '@/lib/adminGuard';
import { lastToastBusinessDates } from '@/lib/pos/toastBusinessDate';
import { readToastDailySales } from '@/lib/pos/toastDailySales';
import { clampRange, datesBetween, previousRange } from '@/lib/analytics/range';
import type { AnalyticsDailyResult } from '@/lib/analytics/daily';

// Only server actions are exported from this file — no types, no constants.
// A 'use server' module registers every export as an action, and a
// re-exported type becomes a ReferenceError at module load that takes every
// action on the page down with it (see actions/toastDailySales.ts). Types
// live in src/lib/analytics and src/lib/pos and are imported from there.

/**
 * The stored daily figures for a window of Toast business days, oldest
 * first, plus the same-length window before it when that one exists in full
 * (null otherwise — the dashboard then shows no comparison rather than a
 * comparison against a partial period). Admin only: the figures are money.
 *
 * Nothing here calls Toast. A day never read comes back with computedAt
 * null, and the Ventas dashboard is where it gets read.
 */
export async function getAnalyticsDaily(from: string, to: string): Promise<AnalyticsDailyResult> {
    const today = lastToastBusinessDates(1)[0];
    const empty = { today, range: { from, to }, rows: [], previous: null };
    if (!(await isAdminSession())) return { success: false, error: 'Solo un administrador puede ver las ventas.', code: 'NOT_ADMIN', ...empty };
    const range = clampRange(from, to, today);
    if (!range) return { success: false, error: 'El período no es válido.', code: 'BAD_DATE', ...empty };
    try {
        const prev = previousRange(range);
        const [rows, prevRows] = await Promise.all([
            readToastDailySales(datesBetween(range.from, range.to)),
            prev ? readToastDailySales(datesBetween(prev.from, prev.to)) : Promise.resolve(null)
        ]);
        return { success: true, today, range, rows, previous: prev && prevRows ? { range: prev, rows: prevRows } : null };
    } catch (e) {
        console.error('Read analytics daily sales failed:', e instanceof Error ? e.message : e);
        return { success: false, error: 'No se pudieron leer las ventas guardadas.', code: 'READ_FAILED', ...empty };
    }
}
