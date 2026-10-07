'use server';

import prisma from '@/lib/prisma';
import { TipDayStatus } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { fetchToastEmployees, fetchToastOrders, ToastError } from '@/lib/toast/client';
import { aggregateToastTips, toEmployeeTipRows } from '@/lib/toast/tips';
import { getBusinessDate, businessDateToUtcDate } from '@/lib/businessDay';
import { isAdminSession } from '@/lib/adminGuard';

const TIPS_ROUTE = '/[locale]/tips-reviews';

export type ToastTipSyncSummary = {
    businessDate: string;
    ordersScanned: number;
    checksCounted: number;
    paymentsCounted: number;
    unsettledPaymentCount: number;
    cardTipsCents: number;
    tipRefundCents: number;
    serviceChargeCents: number;
    employees: { name: string; tipCents: number; serviceChargeCents: number; matched: boolean }[];
    /** Servers with no EmployeeRate.toastEmployeeGuid, by Toast name. */
    unmatched: string[];
    durationMs: number;
    truncated: boolean;
};

const isBusinessDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Integer cents to the string a Decimal(10,2) column takes, exactly. */
const money = (cents: number): string => (cents / 100).toFixed(2);

/**
 * Read one business day's card tips and service charges out of Toast and set
 * them as the TipDay's targets, with a per-server breakdown cached in
 * TipDayEmployeeTip. Replaces syncCloverTips.
 *
 * Toast is authoritative for the two card figures, same as Clover was: the
 * sync sets totalCreditTips and totalServiceCharge outright. Tips rung by
 * anyone — owner included — count toward the day, because they go to the
 * pool. An admin can still override either total afterwards through
 * setTipTargets, which audits.
 *
 * Never touches TipShiftEntry rows or totalCashTips. Creates the TipDay if it
 * does not exist. Today is open to anyone on the page; any other date needs an
 * admin session, matching the editor, where only an admin can unlock a past day.
 */
export async function syncToastTips(businessDate?: string): Promise<{
    success: boolean;
    error?: string;
    summary?: ToastTipSyncSummary;
}> {
    const startedAt = Date.now();
    const today = getBusinessDate();
    const date = businessDate ?? today;

    if (!isBusinessDate(date) || date > today) {
        return { success: false, error: 'La fecha no es válida.' };
    }
    if (date !== today && !(await isAdminSession())) {
        return { success: false, error: 'Solo un administrador puede sincronizar un día anterior.' };
    }

    try {
        const dateValue = businessDateToUtcDate(date);

        // A submitted day is a finished distribution; moving its targets
        // underneath it would leave it reading as reconciled against figures
        // nobody distributed.
        const existing = await prisma.tipDay.findUnique({
            where: { businessDate: dateValue },
            select: { status: true }
        });
        if (existing?.status === TipDayStatus.ENVIADO) {
            return {
                success: false,
                error: 'Este día ya fue enviado. Pide a un administrador que lo reabra antes de sincronizar con Toast.'
            };
        }

        const [{ orders, truncated }, toastEmployees, rates] = await Promise.all([
            fetchToastOrders(date.replace(/-/g, '')),
            fetchToastEmployees(),
            prisma.employeeRate.findMany({
                where: { toastEmployeeGuid: { not: null } },
                select: { cloverEmployeeId: true, employeeName: true, toastEmployeeGuid: true }
            })
        ]);

        // A capped read would understate the day. Wrong is worse than absent
        // for a figure people are paid against, so nothing is written.
        if (truncated) {
            return { success: false, error: 'Toast devolvió más órdenes de las que se pueden leer. No se guardó nada.' };
        }

        const agg = aggregateToastTips(orders);
        const toastNames = new Map(toastEmployees.map(e => [e.guid, `${e.firstName} ${e.lastName}`.trim()]));
        const rows = toEmployeeTipRows(agg.servers, rates, toastNames);

        const durationMs = Date.now() - startedAt;
        const syncedAt = new Date();
        const totals = {
            totalCreditTips: money(agg.tipCents),
            totalServiceCharge: money(agg.serviceChargeCents)
        };

        await prisma.$transaction(async tx => {
            const day = await tx.tipDay.upsert({
                where: { businessDate: dateValue },
                create: {
                    businessDate: dateValue,
                    ...totals,
                    // Same invariant ensureTipDay keeps: a day always has at
                    // least one shift, so the editor never opens empty.
                    shifts: { create: { orderIndex: 0 } }
                },
                update: totals,
                select: { id: true }
            });

            // Wholesale refresh: the cache mirrors the last run and nothing else.
            await tx.tipDayEmployeeTip.deleteMany({ where: { tipDayId: day.id } });
            if (rows.length > 0) {
                await tx.tipDayEmployeeTip.createMany({
                    data: rows.map(r => ({
                        tipDayId: day.id,
                        cloverEmployeeId: r.cloverEmployeeId,
                        employeeName: r.employeeName,
                        paymentCount: r.paymentCount,
                        cardTips: money(r.tipCents),
                        serviceCharge: money(r.serviceChargeCents),
                        salesAmount: money(r.salesCents),
                        syncedAt
                    }))
                });
            }
        });

        revalidatePath(TIPS_ROUTE, 'page');

        return {
            success: true,
            summary: {
                businessDate: date,
                ordersScanned: agg.ordersScanned,
                checksCounted: agg.checksCounted,
                paymentsCounted: agg.paymentsCounted,
                unsettledPaymentCount: agg.unsettledPaymentCount,
                cardTipsCents: agg.tipCents,
                tipRefundCents: agg.tipRefundCents,
                serviceChargeCents: agg.serviceChargeCents,
                employees: rows.map(r => ({
                    name: r.employeeName,
                    tipCents: r.tipCents,
                    serviceChargeCents: r.serviceChargeCents,
                    matched: r.matched
                })),
                unmatched: rows.filter(r => !r.matched).map(r => r.employeeName),
                durationMs,
                truncated
            }
        };
    } catch (e) {
        console.error('Failed to sync Toast tips:', e instanceof Error ? e.message : e);
        if (e instanceof ToastError) return { success: false, error: e.message };
        return { success: false, error: 'No se pudo sincronizar con Toast.' };
    }
}
