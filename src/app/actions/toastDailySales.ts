'use server';

import { revalidatePath } from 'next/cache';
import { isAdminSession } from '@/lib/adminGuard';
import { lastToastBusinessDates, toastBusinessDatesSince, TOAST_FIRST_BUSINESS_DATE } from '@/lib/pos/toastBusinessDate';
import { readToastDailySales, snapshotToastDailySalesCore } from '@/lib/pos/toastDailySales';
import type { DailySalesReport, DailySalesRow } from '@/lib/pos/toastDailySales';

// No `export type { … }` here: a 'use server' module may only export server
// actions, and the bundler registers every export as one — a re-exported type
// becomes `ensureServerEntryExports([…, DailySalesReport])` and throws a
// ReferenceError at module load, taking every action on the page down with it.
// Types are imported from the lib module directly instead.

const SALES_ROUTE = '/[locale]/sales';

/** With no date given, today and yesterday are re-read: a table left open overnight closes in the morning. */
const REFRESH_DAYS = 2;

/** The most history one read returns; the table shows everything since Toast started up to this. */
const MAX_DAYS = 60;

const isBusinessDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * Pull one Toast business day ('YYYY-MM-DD', since Toast started, not in the
 * future) — or, with no date, today and yesterday — and rewrite its
 * PosDailySales row. Admin only; the figures are money the owner reads.
 */
export async function refreshToastDailySales(businessDate?: string): Promise<{ success: boolean; error?: string; reports?: DailySalesReport[] }> {
    if (!(await isAdminSession())) return { success: false, error: 'Solo un administrador puede actualizar las ventas.' };
    const today = lastToastBusinessDates(1)[0];
    let dates: string[];
    if (businessDate === undefined) {
        dates = lastToastBusinessDates(REFRESH_DAYS);
    } else if (!isBusinessDate(businessDate) || businessDate > today || businessDate < TOAST_FIRST_BUSINESS_DATE) {
        return { success: false, error: 'La fecha no es válida.' };
    } else {
        dates = [businessDate];
    }
    try {
        const reports = await snapshotToastDailySalesCore(dates);
        revalidatePath(SALES_ROUTE, 'page');
        return { success: true, reports };
    } catch (e) {
        console.error('Refresh Toast daily sales failed:', e instanceof Error ? e.message : e);
        return { success: false, error: 'No se pudieron actualizar las ventas de Toast.' };
    }
}

/**
 * The stored figures, oldest first, plus which date is today. By default every
 * Toast business day since the first one, capped at the last MAX_DAYS; a day
 * never read comes back with computedAt null.
 */
export async function getToastDailySales(days?: number): Promise<{ success: boolean; error?: string; today: string; rows: DailySalesRow[] }> {
    const all = toastBusinessDatesSince(TOAST_FIRST_BUSINESS_DATE);
    const wanted = days === undefined ? all.length : Math.max(days, 1);
    const dates = all.slice(-Math.min(wanted, MAX_DAYS));
    const today = lastToastBusinessDates(1)[0];
    if (!(await isAdminSession())) return { success: false, error: 'Solo un administrador puede ver las ventas.', today, rows: [] };
    try {
        return { success: true, today, rows: await readToastDailySales(dates) };
    } catch (e) {
        console.error('Read Toast daily sales failed:', e instanceof Error ? e.message : e);
        return { success: false, error: 'No se pudieron leer las ventas guardadas.', today, rows: [] };
    }
}
