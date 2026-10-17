'use server';

import prisma from '@/lib/prisma';
import { PosSource } from '@prisma/client';
import { isAdminSession } from '@/lib/adminGuard';
import { isBusinessDate } from '@/lib/analytics/range';
import { dateColumn } from '@/lib/pos/toastBusinessDate';

/** The dishes sold (paid) on one Toast business day, biggest first — the phone's day sheet. Admin only. */
export async function getToastDailyItemsForDay(date: string): Promise<{ success: boolean; items: { name: string; qty: number; cents: number }[] }> {
    if (!(await isAdminSession()) || !isBusinessDate(date)) return { success: false, items: [] };
    try {
        const rows = await prisma.posDailyItemSales.findMany({
            where: { source: PosSource.TOAST, businessDate: dateColumn(date), kind: 'ITEM', paidQty: { gt: 0 } },
            orderBy: { paidCents: 'desc' },
            take: 60,
            select: { displayName: true, paidQty: true, paidCents: true },
        });
        return { success: true, items: rows.map(r => ({ name: r.displayName, qty: r.paidQty, cents: r.paidCents })) };
    } catch (e) {
        console.error('Day items failed:', e instanceof Error ? e.message : e);
        return { success: false, items: [] };
    }
}
