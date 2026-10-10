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

export type DailySalesReport = ToastDailySalesTotals & {
    date: string;
    /** Why nothing was written, when nothing was. */
    skipped?: string;
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
    computedAt: string | null;
};

const isBusinessDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function snapshotToastDailySalesCore(businessDates: string[]): Promise<DailySalesReport[]> {
    const reports: DailySalesReport[] = [];
    for (const date of businessDates) reports.push(await snapshotOneDay(date));
    return reports;
}

async function snapshotOneDay(date: string): Promise<DailySalesReport> {
    const skip = (why: string): DailySalesReport =>
        ({ ...emptyDailySalesTotals(), date, skipped: why, computedAt: new Date().toISOString() });
    if (!isBusinessDate(date)) return skip('Fecha no válida.');

    try {
        const { orders, truncated } = await fetchToastOrders(date.replace(/-/g, ''));
        if (truncated) return skip('Toast devolvió más órdenes de las que se pueden leer. No se guardó el día.');

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
        return skip(e instanceof ToastError ? e.message : 'No se pudo leer el día en Toast.');
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
                computedAt: r.computedAt.toISOString()
            }
            : { date, netPaidCents: 0, netOpenCents: 0, surchargeCents: 0, gratuityCents: 0, otherChargeCents: 0, paidChecks: 0, openChecks: 0, computedAt: null };
    });
}
