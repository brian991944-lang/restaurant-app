'use server';

import prisma from '@/lib/prisma';
import { PosSource } from '@prisma/client';
import { isAdminSession } from '@/lib/adminGuard';
import { lastToastBusinessDates, shiftDate, dateColumn } from '@/lib/pos/toastBusinessDate';
import { readToastDailySales } from '@/lib/pos/toastDailySales';
import type { DailySalesRow } from '@/lib/pos/toastDailySales';

// "Hoy" — the phone home screen. Today's Toast figures against the same
// weekday last week, the top dishes so far, and what needs the owner
// (Compras, spares opened, cleanings that didn't add up). Admin only.

export interface HoyTopItem { name: string; qty: number; cents: number }
export interface HoyPending {
    comprasPorPedir: number;
    comprasByProvider: { provider: string; count: number }[];
    repuestosAbiertos: { name: string; nameEs: string | null; openedAt: string }[];
    limpiezasFaltante: { raw: string; rawEs: string | null; date: string; unaccountedLb: number; cooks: string | null }[];
}
export interface HoyResult {
    success: boolean;
    code?: 'NOT_ADMIN' | 'FAILED';
    today: string;
    /** New York hour right now (0–23), to cut last week's hourly series "a esta hora". */
    nowHour: number;
    row: DailySalesRow | null;
    lastWeek: DailySalesRow | null;
    top: HoyTopItem[];
    pending: HoyPending;
}

const NY_HOUR = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false });

export async function getHoyOverview(): Promise<HoyResult> {
    const today = lastToastBusinessDates(1)[0];
    const lastWeekDate = shiftDate(today, -7);
    const h = Number(NY_HOUR.format(new Date()));
    const nowHour = h === 24 ? 0 : h;
    const empty: HoyResult = { success: false, today, nowHour, row: null, lastWeek: null, top: [], pending: { comprasPorPedir: 0, comprasByProvider: [], repuestosAbiertos: [], limpiezasFaltante: [] } };
    if (!(await isAdminSession())) return { ...empty, code: 'NOT_ADMIN' };
    try {
        const weekAgo = new Date(Date.now() - 7 * 86400000);
        const [rows, items, compras, spares, cleanings] = await Promise.all([
            readToastDailySales([today, lastWeekDate]),
            prisma.posDailyItemSales.findMany({
                where: { source: PosSource.TOAST, businessDate: dateColumn(today), kind: 'ITEM' },
                orderBy: { paidCents: 'desc' },
                take: 5,
                select: { displayName: true, paidQty: true, paidCents: true },
            }),
            prisma.ingredient.findMany({
                where: { needsOrdering: true, isActive: true },
                select: { provider: { select: { name: true } } },
            }),
            prisma.ingredient.findMany({
                where: { trackMode: 'SPARE', isActive: true, spareOpenedAt: { gte: weekAgo }, storageStocks: { none: { qty: { gt: 0 } } } },
                orderBy: { spareOpenedAt: 'desc' },
                take: 5,
                select: { name: true, nameEs: true, spareOpenedAt: true },
            }),
            prisma.cleaningSession.findMany({
                where: { flag: 'MISSING', createdAt: { gte: weekAgo } },
                orderBy: { createdAt: 'desc' },
                take: 5,
                select: { createdAt: true, unaccountedLb: true, cookNames: true, rawIngredient: { select: { name: true, nameEs: true } } },
            }),
        ]);
        const byProvider = new Map<string, number>();
        for (const c of compras) {
            const k = c.provider?.name ?? '—';
            byProvider.set(k, (byProvider.get(k) ?? 0) + 1);
        }
        const row = rows.find(r => r.date === today) ?? null;
        const lastWeek = rows.find(r => r.date === lastWeekDate) ?? null;
        return {
            success: true,
            today,
            nowHour,
            row: row && row.computedAt ? row : null,
            lastWeek: lastWeek && lastWeek.computedAt ? lastWeek : null,
            top: items.filter(i => i.paidCents > 0).map(i => ({ name: i.displayName, qty: i.paidQty, cents: i.paidCents })),
            pending: {
                comprasPorPedir: compras.length,
                comprasByProvider: [...byProvider.entries()].map(([provider, count]) => ({ provider, count })).sort((a, b) => b.count - a.count),
                repuestosAbiertos: spares.map(s => ({ name: s.name, nameEs: s.nameEs, openedAt: s.spareOpenedAt!.toISOString() })),
                limpiezasFaltante: cleanings.map(c => ({ raw: c.rawIngredient.name, rawEs: c.rawIngredient.nameEs, date: c.createdAt.toISOString(), unaccountedLb: c.unaccountedLb, cooks: c.cookNames })),
            },
        };
    } catch (e) {
        console.error('Hoy overview failed:', e instanceof Error ? e.message : e);
        return { ...empty, code: 'FAILED' };
    }
}
