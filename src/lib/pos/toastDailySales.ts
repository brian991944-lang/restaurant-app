/**
 * Daily net sales from Toast: read a business day's orders, reduce them with
 * src/lib/toast/dailySales.ts, and keep one PosDailySales row per day.
 *
 * Called by the admin refresh action and by the nightly cron (last 3 days).
 * A day that cannot be read is reported as skipped and its stored row, if
 * any, is left alone — wrong is worse than stale for a figure the owner
 * reads as money.
 */

import prisma from '@/lib/prisma';
import { PosSource } from '@prisma/client';
import { fetchToastOrders, ToastError } from '@/lib/toast/client';
import { aggregateToastDailySales, emptyDailySalesTotals, type ToastDailySalesTotals } from '@/lib/toast/dailySales';
import { dateColumn } from './toastBusinessDate';

/** Why a day was not written, for the UI to say in its own language. */
export type SkippedCode = 'BAD_DATE' | 'TRUNCATED' | 'TOAST_ENV' | 'TOAST_HTTP' | 'TOAST_FAILED';

/**
 * Why an action was refused or failed; the page translates it, the Spanish
 * `error` string stays for logs. Lives here, not in the actions file: a
 * 'use server' module may export nothing but server actions.
 */
export type SalesErrorCode = 'NOT_ADMIN' | 'BAD_DATE' | 'FAILED' | 'READ_FAILED';

export type DailySalesReport = ToastDailySalesTotals & {
    date: string;
    /** Why nothing was written, when nothing was (Spanish, for logs and the script). */
    skipped?: string;
    skippedCode?: SkippedCode;
    /** The HTTP status when skippedCode is TOAST_HTTP. */
    skippedStatus?: number;
    computedAt: string;
};

/** What the Ventas page shows per day. computedAt is null for a day never read. */
export type DailySalesRow = {
    date: string;
    netPaidCents: number;
    netOpenCents: number;
    surchargeCents: number;
    gratuityCents: number;
    otherChargeCents: number;
    paidChecks: number;
    openChecks: number;
    /** Null on a row read before these figures existed: the page offers to read the day again. */
    cashChecks: number | null;
    cashNetCents: number | null;
    computedAt: string | null;
};

const isBusinessDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function snapshotToastDailySalesCore(businessDates: string[]): Promise<DailySalesReport[]> {
    const reports: DailySalesReport[] = [];
    for (const date of businessDates) reports.push(await snapshotOneDay(date));
    return reports;
}

async function snapshotOneDay(date: string): Promise<DailySalesReport> {
    const skip = (why: string, skippedCode: SkippedCode, skippedStatus?: number): DailySalesReport =>
        ({ ...emptyDailySalesTotals(), date, skipped: why, skippedCode, skippedStatus, computedAt: new Date().toISOString() });
    if (!isBusinessDate(date)) return skip('Fecha no válida.', 'BAD_DATE');

    try {
        const { orders, truncated } = await fetchToastOrders(date.replace(/-/g, ''));
        if (truncated) return skip('Toast devolvió más órdenes de las que se pueden leer. No se guardó el día.', 'TRUNCATED');

        const totals = aggregateToastDailySales(orders);
        const computedAt = new Date();
        const fields = {
            netPaidCents: totals.netPaidCents,
            netOpenCents: totals.netOpenCents,
            surchargeCents: totals.surchargeCents,
            gratuityCents: totals.gratuityCents,
            otherChargeCents: totals.otherChargeCents,
            paidChecks: totals.paidChecks,
            openChecks: totals.openChecks,
            voidedChecks: totals.voidedChecks,
            ordersScanned: totals.ordersScanned,
            cashChecks: totals.cashChecks,
            cashNetCents: totals.cashNetCents,
            computedAt
        };
        await prisma.posDailySales.upsert({
            where: { source_businessDate: { source: PosSource.TOAST, businessDate: dateColumn(date) } },
            create: { source: PosSource.TOAST, businessDate: dateColumn(date), ...fields },
            update: fields
        });
        return { ...totals, date, computedAt: computedAt.toISOString() };
    } catch (e) {
        console.error(`Toast daily sales ${date} failed:`, e instanceof Error ? e.message : e);
        if (e instanceof ToastError) {
            // status 0 = the credentials are not configured; anything else is Toast's answer.
            return e.status > 0 ? skip(e.message, 'TOAST_HTTP', e.status) : skip(e.message, 'TOAST_ENV');
        }
        return skip('No se pudo leer el día en Toast.', 'TOAST_FAILED');
    }
}

/** The stored figures for each requested date, in the order given; a day never read comes back empty. */
export async function readToastDailySales(businessDates: string[]): Promise<DailySalesRow[]> {
    const dates = businessDates.filter(isBusinessDate);
    const stored = await prisma.posDailySales.findMany({
        where: { source: PosSource.TOAST, businessDate: { in: dates.map(dateColumn) } }
    });
    const byDate = new Map(stored.map(r => [r.businessDate.toISOString().slice(0, 10), r]));
    return dates.map(date => {
        const r = byDate.get(date);
        return r
            ? {
                date,
                netPaidCents: r.netPaidCents,
                netOpenCents: r.netOpenCents,
                surchargeCents: r.surchargeCents,
                gratuityCents: r.gratuityCents,
                otherChargeCents: r.otherChargeCents,
                paidChecks: r.paidChecks,
                openChecks: r.openChecks,
                cashChecks: r.cashChecks,
                cashNetCents: r.cashNetCents,
                computedAt: r.computedAt.toISOString()
            }
            : { date, netPaidCents: 0, netOpenCents: 0, surchargeCents: 0, gratuityCents: 0, otherChargeCents: 0, paidChecks: 0, openChecks: 0, cashChecks: null, cashNetCents: null, computedAt: null };
    });
}
