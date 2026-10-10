'use server';

import { revalidatePath } from 'next/cache';
import { isAdminSession } from '@/lib/adminGuard';
import { lastToastBusinessDates } from '@/lib/pos/toastBusinessDate';
import { readToastDailySales, snapshotToastDailySalesCore, type DailySalesReport, type DailySalesRow } from '@/lib/pos/toastDailySales';

export type { DailySalesReport, DailySalesRow };

const SALES_ROUTE = '/[locale]/sales';

/** Today and yesterday are re-read: a table left open overnight closes in the morning. */
const REFRESH_DAYS = 2;

/**
 * Pull today's (and yesterday's) orders from Toast and rewrite their
 * PosDailySales rows. Admin only; the figures are money the owner reads.
 */
export async function refreshToastDailySales(): Promise<{ success: boolean; error?: string; reports?: DailySalesReport[] }> {
    if (!(await isAdminSession())) return { success: false, error: 'Solo un administrador puede actualizar las ventas.' };
    try {
        const reports = await snapshotToastDailySalesCore(lastToastBusinessDates(REFRESH_DAYS));
        revalidatePath(SALES_ROUTE, 'page');
        return { success: true, reports };
    } catch (e) {
        console.error('Refresh Toast daily sales failed:', e instanceof Error ? e.message : e);
        return { success: false, error: 'No se pudieron actualizar las ventas de Toast.' };
    }
}

/** The last `days` Toast business days, oldest first, plus which one is today. */
export async function getToastDailySales(days = 14): Promise<{ success: boolean; error?: string; today: string; rows: DailySalesRow[] }> {
    const dates = lastToastBusinessDates(Math.min(Math.max(days, 1), 60));
    const today = dates[dates.length - 1];
    if (!(await isAdminSession())) return { success: false, error: 'Solo un administrador puede ver las ventas.', today, rows: [] };
    try {
        return { success: true, today, rows: await readToastDailySales(dates) };
    } catch (e) {
        console.error('Read Toast daily sales failed:', e instanceof Error ? e.message : e);
        return { success: false, error: 'No se pudieron leer las ventas guardadas.', today, rows: [] };
    }
}
