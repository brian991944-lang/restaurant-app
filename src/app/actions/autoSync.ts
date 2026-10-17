'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { PosSource } from '@prisma/client';
import { isAdminSession } from '@/lib/adminGuard';
import { lastToastBusinessDates, dateColumn } from '@/lib/pos/toastBusinessDate';
import { snapshotToastDailySalesCore } from '@/lib/pos/toastDailySales';
import { isConnected as gbpConnected } from '@/lib/gbp/auth';
import { runFullSync as gbpSync } from '@/lib/gbp/sync';

// Auto-sync on open. The Admin app calls this every time it comes to the
// foreground (see components/AutoSync.tsx) so the owner never presses a
// refresh button: Toast is re-read when today's figures are older than
// TOAST_MAX_AGE, Google when its last sync is older than GOOGLE_MAX_AGE.
// Both checks are server-side, so several devices opening at once still make
// one read every few minutes, not one per device. The big "Sync" button in
// Analytics stays for backfills; this is the quiet, routine path.

const TOAST_MAX_AGE_MS = 10 * 60 * 1000;   // today's Toast figures are good for 10 minutes
const GOOGLE_MAX_AGE_MS = 60 * 60 * 1000;  // Google reviews/metrics: once an hour is plenty
const BUDGET_MS = 40_000;                  // leave headroom under the 60 s Hobby ceiling

export type AutoSyncSourceState = 'fresh' | 'synced' | 'failed' | 'skipped' | 'not_connected';

export interface AutoSyncResult {
    success: boolean;
    code?: 'NOT_ADMIN';
    toast: AutoSyncSourceState;
    google: AutoSyncSourceState;
    /** When today's Toast figures were last written, after this call. */
    toastUpdatedAt: string | null;
    tookMs: number;
}

export async function autoSyncOnOpen(): Promise<AutoSyncResult> {
    const startedAt = Date.now();
    const elapsed = () => Date.now() - startedAt;
    const result: AutoSyncResult = { success: false, toast: 'skipped', google: 'skipped', toastUpdatedAt: null, tookMs: 0 };
    if (!(await isAdminSession())) return { ...result, code: 'NOT_ADMIN', tookMs: elapsed() };

    // ── Toast: today (and yesterday, so a table left open overnight closes) ──
    const today = lastToastBusinessDates(1)[0];
    try {
        const row = await prisma.posDailySales.findUnique({
            where: { source_businessDate: { source: PosSource.TOAST, businessDate: dateColumn(today) } },
            select: { computedAt: true },
        });
        const age = row ? Date.now() - row.computedAt.getTime() : Infinity;
        if (age < TOAST_MAX_AGE_MS) {
            result.toast = 'fresh';
            result.toastUpdatedAt = row!.computedAt.toISOString();
        } else {
            const reports = await snapshotToastDailySalesCore(lastToastBusinessDates(2));
            const todayReport = reports.find(r => r.date === today);
            result.toast = todayReport && !todayReport.skipped ? 'synced' : 'failed';
            result.toastUpdatedAt = todayReport && !todayReport.skipped ? todayReport.computedAt : row?.computedAt.toISOString() ?? null;
        }
    } catch (e) {
        console.error('Auto-sync Toast failed:', e instanceof Error ? e.message : e);
        result.toast = 'failed';
    }

    // ── Google Business Profile: reviews + a few days of metrics, hourly at most ──
    if (elapsed() <= BUDGET_MS) {
        try {
            if (!(await gbpConnected())) {
                result.google = 'not_connected';
            } else {
                const [lastReview, lastMetric] = await Promise.all([
                    prisma.gbpReview.aggregate({ _max: { syncedAt: true } }),
                    prisma.gbpDailyMetric.aggregate({ _max: { syncedAt: true } }),
                ]);
                const last = Math.max(lastReview._max.syncedAt?.getTime() ?? 0, lastMetric._max.syncedAt?.getTime() ?? 0);
                if (Date.now() - last < GOOGLE_MAX_AGE_MS) {
                    result.google = 'fresh';
                } else {
                    await gbpSync({ maxPages: 1, metricDays: 3 });
                    result.google = 'synced';
                }
            }
        } catch (e) {
            console.error('Auto-sync Google failed:', e instanceof Error ? e.message : e);
            result.google = 'failed';
        }
    }

    if (result.toast === 'synced' || result.google === 'synced') {
        revalidatePath('/[locale]/analytics/[view]', 'page');
        revalidatePath('/[locale]/dashboard', 'page');
    }
    return { ...result, success: true, tookMs: elapsed() };
}
