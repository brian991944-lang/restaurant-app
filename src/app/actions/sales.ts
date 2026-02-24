'use server';

import prisma from '@/lib/prisma';

export async function getSalesAuditData() {
    try {
        const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

        const lineItems = await prisma.processedCloverLineItem.findMany({
            where: { createdTime: { gte: threeDaysAgo } },
            include: { modifiers: true },
            orderBy: { createdTime: 'asc' }
        });

        // Grouping: Date -> Category -> Item -> { qty, modifiers: { ModName: qty } }
        const grouped: Record<string, Record<string, Record<string, { qty: number, modifiers: Record<string, number> }>>> = {};

        for (const li of lineItems) {
            const dateStr = li.createdTime.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });

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

        // We want an array of 3 days. Let's find the last 3 days starting from today down.
        const days = [];
        for (let i = 2; i >= 0; i--) {
            const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
            days.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' }));
        }

        return { success: true, grouped, days };
    } catch (e) {
        console.error("Failed to get sales audit data:", e);
        return { success: false, error: 'Failed to get sales data' };
    }
}
