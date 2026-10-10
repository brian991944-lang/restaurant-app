'use server';

import prisma from '@/lib/prisma';
import { PosSource } from '@prisma/client';
import { getBusinessDate, getScheduleWindowUtc } from '@/lib/businessDay';
import { lastToastBusinessDates } from '@/lib/pos/toastBusinessDate';
import { readToastDailyItems } from '@/lib/pos/toastDailySales';

/** 'YYYY-MM-DD' plus n days (pure calendar math, no TZ involved). */
function shiftDate(dateStr: string, days: number): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + days, 12)).toISOString().slice(0, 10);
}

/**
 * Clover audit for the last 3 operational business days (5 AM NY cutover):
 * `days` are 'YYYY-MM-DD' business dates, oldest first, and `grouped` is
 * keyed by them. The page formats the dates in the reader's language.
 */
export async function getSalesAuditData() {
    try {
        // Sales rung up after midnight count toward the previous day.
        const businessDates = [-2, -1, 0].map(off => shiftDate(getBusinessDate(), off));
        // NY midnight of the oldest business date is always at or before that
        // day's 5 AM start; rows attributed earlier are skipped in the loop.
        const windowStart = getScheduleWindowUtc(businessDates[0]).start;

        const lineItems = await prisma.processedCloverLineItem.findMany({
            where: { createdTime: { gte: windowStart } },
            include: { modifiers: true },
            orderBy: { createdTime: 'asc' }
        });

        // Grouping: Date -> Category -> Item -> { qty, modifiers: { ModName: qty } }
        const grouped: Record<string, Record<string, Record<string, { qty: number, modifiers: Record<string, number> }>>> = {};

        for (const li of lineItems) {
            const dateStr = getBusinessDate(li.createdTime);
            if (!businessDates.includes(dateStr)) continue; // outside the 3-day audit window

            const cat = li.categoryName || 'Uncategorized';

            // Filter out Uncategorized and Drinks
            if (cat === 'Uncategorized' || cat.toLowerCase().includes('drink') || cat.toLowerCase().includes('bebida') || cat === 'Beverages') {
                continue;
            }

            const item = li.itemName || 'Unknown Item';

            if (!grouped[dateStr]) grouped[dateStr] = {};
            if (!grouped[dateStr][cat]) grouped[dateStr][cat] = {};
            if (!grouped[dateStr][cat][item]) {
                grouped[dateStr][cat][item] = { qty: 0, modifiers: {} };
            }

            grouped[dateStr][cat][item].qty += li.qty;

            for (const mod of li.modifiers) {
                const modName = mod.modifierName || 'Unknown Modifier';
                if (!grouped[dateStr][cat][item].modifiers[modName]) {
                    grouped[dateStr][cat][item].modifiers[modName] = 0;
                }
                grouped[dateStr][cat][item].modifiers[modName] += mod.qty;
            }
        }

        return { success: true, grouped, days: businessDates };
    } catch (e) {
        console.error("Failed to get sales audit data:", e);
        return { success: false, error: 'Failed to get sales data' };
    }
}

export type ToastAuditModifier = { name: string; qty: number };
export type ToastAuditItem = { name: string; qty: number; openQty: number; voidedQty: number; linked: boolean; modifiers: ToastAuditModifier[] };
export type ToastAuditDay = { date: string; categories: { name: string; items: ToastAuditItem[] }[] };

/**
 * Toast sales for the last 3 Toast business days (4 AM cutover), from the
 * PosDailyItemSales rows the Sync button and the nightly cron write. Kept
 * apart from the Clover audit above: the two POS feeds are shown side by
 * side and never summed. qty counts paid checks; a selection on a check
 * still open is listed under openQty so an unpaid table does not read as a
 * sale.
 */
export async function getToastSalesAuditData(): Promise<{ success: boolean; days: ToastAuditDay[]; error?: string }> {
    try {
        const dates = lastToastBusinessDates(3);
        const rows = await readToastDailyItems(dates);
        const menuIds = [...new Set(rows.map(r => r.menuItemId).filter((x): x is string => !!x))];
        const menuItems = await prisma.menuItem.findMany({ where: { id: { in: menuIds } }, select: { id: true, category: true } });
        const categoryOf = new Map(menuItems.map(m => [m.id, m.category || 'Sin categoría']));

        const days: ToastAuditDay[] = dates.map(date => {
            const byCat = new Map<string, Map<string, ToastAuditItem>>();
            const itemsByGuid = new Map<string, ToastAuditItem>();
            for (const r of rows) {
                if (r.date !== date || r.kind !== 'ITEM') continue;
                const cat = r.menuItemId ? categoryOf.get(r.menuItemId) ?? 'Sin categoría' : 'Sin vincular';
                const items = byCat.get(cat) ?? new Map<string, ToastAuditItem>();
                const it = items.get(r.displayName) ?? { name: r.displayName, qty: 0, openQty: 0, voidedQty: 0, linked: !!r.menuItemId, modifiers: [] };
                it.qty += r.paidQty;
                it.openQty += r.openQty;
                it.voidedQty += r.voidedQty;
                items.set(r.displayName, it);
                byCat.set(cat, items);
                itemsByGuid.set(r.posItemGuid, it);
            }
            for (const r of rows) {
                if (r.date !== date || r.kind !== 'MODIFIER') continue;
                const parent = itemsByGuid.get(r.parentPosItemGuid);
                if (!parent) continue;
                const qty = r.paidQty + r.openQty;
                if (qty <= 0) continue;
                const existing = parent.modifiers.find(m => m.name === r.displayName);
                if (existing) existing.qty += qty; else parent.modifiers.push({ name: r.displayName, qty });
            }
            return {
                date,
                categories: [...byCat.entries()]
                    .sort(([a], [b]) => (a === 'Sin vincular' ? 1 : b === 'Sin vincular' ? -1 : a.localeCompare(b)))
                    .map(([name, items]) => ({
                        name,
                        items: [...items.values()]
                            .filter(it => it.qty > 0 || it.openQty > 0 || it.voidedQty > 0)
                            .map(it => ({ ...it, modifiers: [...it.modifiers].sort((a, b) => a.name.localeCompare(b.name)) }))
                            .sort((a, b) => a.name.localeCompare(b.name))
                    }))
                    .filter(c => c.items.length > 0)
            };
        });
        return { success: true, days };
    } catch (e) {
        console.error('Failed to get Toast sales audit data:', e);
        return { success: false, days: [], error: 'No se pudieron leer las ventas de Toast.' };
    }
}
