/**
 * Salón live stock: the last physical count minus Toast sales since then.
 *
 * Nothing here moves stock. SalonStock keeps the count exactly as counted
 * (qtyFront / qtyBodega at countedAt); the live figure is derived on read from
 * the Toast item sales the app already stores per business day
 * (PosDailyItemSales — refreshed by the on-open sync, by the Salón page itself
 * when today's figures are older than 10 minutes, and by the nightly cron).
 * Paid and open quantities both count and voids do not, the same rule as the
 * kitchen consumption. Sold bottles come off Front first, then Bodega.
 *
 * A drink reaches its Toast sales through its menu item:
 * SalonStock.cloverItemId → MenuItem.cloverId → PosDailyItemSales.menuItemId
 * (which the daily snapshot fills from the Toast item mapping).
 *
 * The count's own business day is split at the count: countBaseQty holds what
 * Toast sold that day before countedAt (fixed when the count is saved), and
 * only the rest of that day is subtracted.
 */
import prisma from '@/lib/prisma';
import { PosSource } from '@prisma/client';
import { fetchToastOrders } from '@/lib/toast/client';
import { aggregateToastDailyItems } from '@/lib/toast/dailySales';
import { fallbackModifierKey } from '@/lib/pos/toastMapping';
import { snapshotToastDailySalesCore } from '@/lib/pos/toastDailySales';
import {
    dateColumn, lastToastBusinessDates, toastBusinessDateOf, TOAST_FIRST_BUSINESS_DATE
} from '@/lib/pos/toastBusinessDate';

/** Today's Toast figures are re-read when older than this — same window as the on-open sync. */
const TOAST_MAX_AGE_MS = 10 * 60 * 1000;

export type SalonLive = {
    /** False when the item has no count time or no Toast link: the stored numbers stand as they are. */
    tracked: boolean;
    front: number;
    bodega: number;
    total: number;
    /** Toast units (paid + open) sold since the count. */
    sold: number;
    countedAt: string | null;
};

export type SalonStockForLive = {
    ingredientId: string;
    qtyFront: number;
    qtyBodega: number;
    countedAt: Date | null;
    countBaseQty: number;
    cloverItemId: string | null;
};

/** ingredientId → the app menu items that sell it. */
async function menuItemsBySalonItem(
    stocks: { ingredientId: string; cloverItemId: string | null }[]
): Promise<Map<string, string[]>> {
    const cloverIds = [...new Set(stocks.map(s => s.cloverItemId).filter((x): x is string => !!x))];
    const items: { id: string; cloverId: string | null }[] = cloverIds.length
        ? await prisma.menuItem.findMany({ where: { cloverId: { in: cloverIds } }, select: { id: true, cloverId: true } })
        : [];
    const byClover = new Map<string, string[]>();
    for (const m of items) {
        if (!m.cloverId) continue;
        byClover.set(m.cloverId, [...(byClover.get(m.cloverId) ?? []), m.id]);
    }
    return new Map(stocks.map(s => [s.ingredientId, s.cloverItemId ? byClover.get(s.cloverItemId) ?? [] : []]));
}

/** Live figures for each stock row, keyed by ingredientId. */
export async function computeSalonLive(stocks: SalonStockForLive[]): Promise<Map<string, SalonLive>> {
    const links = await menuItemsBySalonItem(stocks);
    const counted = stocks.filter(s => s.countedAt && (links.get(s.ingredientId)?.length ?? 0) > 0);
    const firstDay = counted
        .map(s => toastBusinessDateOf(s.countedAt!))
        .reduce<string | null>((min, d) => (!min || d < min ? d : min), null);
    const menuIds = [...new Set(counted.flatMap(s => links.get(s.ingredientId) ?? []))];

    const rows: { menuItemId: string | null; businessDate: Date; paidQty: number; openQty: number }[] =
        firstDay && menuIds.length
            ? await prisma.posDailyItemSales.findMany({
                where: { source: PosSource.TOAST, kind: 'ITEM', menuItemId: { in: menuIds }, businessDate: { gte: dateColumn(firstDay) } },
                select: { menuItemId: true, businessDate: true, paidQty: true, openQty: true }
            })
            : [];

    // menuItemId → business date → units sold (paid + open)
    const sales = new Map<string, Map<string, number>>();
    for (const r of rows) {
        if (!r.menuItemId) continue;
        const day = r.businessDate.toISOString().slice(0, 10);
        const byDay = sales.get(r.menuItemId) ?? new Map<string, number>();
        byDay.set(day, (byDay.get(day) ?? 0) + r.paidQty + r.openQty);
        sales.set(r.menuItemId, byDay);
    }

    const out = new Map<string, SalonLive>();
    for (const s of stocks) {
        const ids = links.get(s.ingredientId) ?? [];
        if (!s.countedAt || ids.length === 0) {
            out.set(s.ingredientId, {
                tracked: false, front: s.qtyFront, bodega: s.qtyBodega, total: s.qtyFront + s.qtyBodega,
                sold: 0, countedAt: s.countedAt?.toISOString() ?? null
            });
            continue;
        }
        const countDay = toastBusinessDateOf(s.countedAt);
        let onCountDay = 0;
        let after = 0;
        for (const id of ids) {
            for (const [day, qty] of sales.get(id) ?? []) {
                if (day === countDay) onCountDay += qty;
                else if (day > countDay) after += qty;
            }
        }
        // A void after the count can take the day below its base; never add stock back for it.
        const sold = Math.max(0, Math.round(onCountDay) - s.countBaseQty) + Math.round(after);
        let front = s.qtyFront - sold;
        let bodega = s.qtyBodega;
        if (front < 0 && bodega > 0) {
            const take = Math.min(bodega, -front);
            front += take;
            bodega -= take;
        }
        out.set(s.ingredientId, { tracked: true, front, bodega, total: front + bodega, sold, countedAt: s.countedAt.toISOString() });
    }
    return out;
}

/**
 * What Toast sold of this drink on the count's business day before the count —
 * already off the shelf when it was counted. Read from Toast when the count is
 * saved, line by line (the selection's own time, else the order's open time).
 * Throws when Toast cannot be read: a wrong base is worse than no count.
 */
export async function countBaseQtyFor(ingredientId: string, cloverItemId: string | null, countedAt: Date): Promise<number> {
    const day = toastBusinessDateOf(countedAt);
    if (day < TOAST_FIRST_BUSINESS_DATE || !cloverItemId) return 0;
    const ids = (await menuItemsBySalonItem([{ ingredientId, cloverItemId }])).get(ingredientId) ?? [];
    if (ids.length === 0) return 0;

    const { orders, truncated } = await fetchToastOrders(day.replace(/-/g, ''));
    if (truncated) throw new Error('Toast devolvió más órdenes de las que se pueden leer.');

    const at = countedAt.getTime();
    const time = (v: unknown): number | null => {
        const t = v ? new Date(String(v)).getTime() : NaN;
        return Number.isNaN(t) ? null : t;
    };
    const beforeCount = orders.map((o: any) => {
        const orderAt = time(o?.openedDate) ?? time(o?.createdDate);
        return {
            ...o,
            checks: (o?.checks ?? []).map((c: any) => ({
                ...c,
                selections: (c?.selections ?? []).filter((sel: any) => {
                    const t = time(sel?.createdDate) ?? orderAt;
                    return t !== null && t < at;
                })
            }))
        };
    });

    const mappings: { posGuid: string }[] = await prisma.posItemMapping.findMany({
        where: { source: PosSource.TOAST, kind: 'ITEM', menuItemId: { in: ids } },
        select: { posGuid: true }
    });
    const guids = new Set(mappings.map(m => m.posGuid));
    const sold = aggregateToastDailyItems(beforeCount, fallbackModifierKey)
        .filter(r => r.kind === 'ITEM' && guids.has(r.posItemGuid))
        .reduce((n, r) => n + r.paidQty + r.openQty, 0);
    return Math.round(sold);
}

/** When today's Toast figures were last written, or null if today has not been read. */
export async function toastTodayUpdatedAt(): Promise<Date | null> {
    const today = lastToastBusinessDates(1)[0];
    const row: { computedAt: Date } | null = await prisma.posDailySales.findUnique({
        where: { source_businessDate: { source: PosSource.TOAST, businessDate: dateColumn(today) } },
        select: { computedAt: true }
    });
    return row?.computedAt ?? null;
}

/**
 * Re-read today (and yesterday, so a table left open overnight closes) from
 * Toast when today's figures are older than 10 minutes. The age check is
 * server-side, so several tablets opening the page still make one read every
 * few minutes. Returns true when new figures were written.
 */
export async function refreshToastSalesIfStale(): Promise<boolean> {
    const updatedAt = await toastTodayUpdatedAt();
    if (updatedAt && Date.now() - updatedAt.getTime() < TOAST_MAX_AGE_MS) return false;
    const today = lastToastBusinessDates(1)[0];
    const reports = await snapshotToastDailySalesCore(lastToastBusinessDates(2));
    return reports.some(r => r.date === today && !r.skipped);
}
