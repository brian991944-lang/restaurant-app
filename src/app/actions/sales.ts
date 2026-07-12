'use server';

import prisma from '@/lib/prisma';
import { getBusinessDate, getScheduleWindowUtc } from '@/lib/businessDay';

/** 'YYYY-MM-DD' plus n days (pure calendar math, no TZ involved). */
function shiftDate(dateStr: string, days: number): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + days, 12)).toISOString().slice(0, 10);
}

/** Short display label ('Jul 8') for a 'YYYY-MM-DD' business date. */
function businessDateLabel(businessDate: string): string {
    return new Date(`${businessDate}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export async function getSalesAuditData() {
    try {
        // Audit covers the last 3 operational business days (5 AM NY cutover),
        // so sales rung up after midnight count toward the previous day.
        const businessDates = [-2, -1, 0].map(off => shiftDate(getBusinessDate(), off));
        const labelByDate = new Map(businessDates.map(bd => [bd, businessDateLabel(bd)]));
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
            const dateStr = labelByDate.get(getBusinessDate(li.createdTime));
            if (!dateStr) continue; // belongs to a business day outside the 3-day audit window

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

        // The same 3 business days, oldest first, as display labels.
        const days = businessDates.map(bd => labelByDate.get(bd)!);

        return { success: true, grouped, days };
    } catch (e) {
        console.error("Failed to get sales audit data:", e);
        return { success: false, error: 'Failed to get sales data' };
    }
}
