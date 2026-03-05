'use server';

import prisma from '@/lib/prisma';

const CLOVER_MERCHANT_ID = '5EFY7JF0XERB1';
const CLOVER_TOKEN = '80bb90a1-8598-71bb-606d-2d8eac4fe14e';

async function depleteInventory(ingredientId: string, quantity: number, note: string) {
    // 1. Deduct from total stock
    await prisma.inventory.update({
        where: { ingredientId: ingredientId },
        data: { frozenQty: { decrement: quantity } }
    }).catch(() => null);

    // 2. Also check unfrozenQuantity on Ingredient
    const ing = await prisma.ingredient.findUnique({ where: { id: ingredientId } });
    if (ing && (ing.unfrozenQuantity || 0) > 0) {
        // Floor at 0 if we deplete more than what's unfrozen
        await prisma.ingredient.update({
            where: { id: ingredientId },
            data: { unfrozenQuantity: Math.max(0, (ing.unfrozenQuantity || 0) - quantity) }
        }).catch(() => null);
    }

    // 3. Log transaction
    await prisma.inventoryTransaction.create({
        data: { ingredientId: ingredientId, type: 'SALES_DEDUCT_CLOVER', qty: quantity, note }
    }).catch(() => null);
}

export async function fetchCloverMenuItems() {
    try {
        const url = `https://api.clover.com/v3/merchants/${CLOVER_MERCHANT_ID}/items?limit=1000`;
        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${CLOVER_TOKEN}`, 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        return data.elements?.map((el: any) => ({ id: el.id, name: el.name })) || [];
    } catch (e) {
        console.error(e);
        return [];
    }
}

export async function fetchCloverModifiers() {
    try {
        const url = `https://api.clover.com/v3/merchants/${CLOVER_MERCHANT_ID}/modifier_groups?expand=modifiers&limit=1000`;
        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${CLOVER_TOKEN}`, 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        let allMods: any[] = [];
        data.elements?.forEach((group: any) => {
            group.modifiers?.elements?.forEach((mod: any) => {
                allMods.push({ id: mod.id, name: mod.name, group: group.name, price: mod.price || 0 });
            });
        });
        // also get standalone modifiers if any, but clover API separates them. Let's fallback to /modifiers endpoint
        const url2 = `https://api.clover.com/v3/merchants/${CLOVER_MERCHANT_ID}/modifiers?limit=1000`;
        const res2 = await fetch(url2, { headers: { 'Authorization': `Bearer ${CLOVER_TOKEN}`, 'Content-Type': 'application/json' } });
        const data2 = await res2.json();
        data2.elements?.forEach((mod: any) => {
            if (!allMods.find(m => m.id === mod.id)) {
                allMods.push({ id: mod.id, name: mod.name, group: 'Misc', price: mod.price || 0 });
            }
        });
        return allMods;
    } catch (e) {
        console.error(e);
        return [];
    }
}

export async function syncCloverSales() {
    try {
        // 1. Delete records older than 3 days (72 hours)
        const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
        await prisma.processedCloverLineItem.deleteMany({
            where: { createdTime: { lt: threeDaysAgo } }
        });

        // 2. Fetch mapped MenuItems and old mapped Ingredients (legacy support)
        const mappedMenuItems = await prisma.menuItem.findMany({
            where: { cloverId: { not: null } },
            include: { recipeIngredients: true, modifiers: { include: { ingredients: true } } }
        });
        const menuItemsByCloverId = new Map(mappedMenuItems.map(i => [i.cloverId, i]));

        // Check if there are ANY mapped ingredients directly (to not break old features)
        const mappedIngredients = await prisma.ingredient.findMany({
            where: { cloverId: { not: null } }
        });
        const ingredientsByCloverId = new Map(mappedIngredients.map(i => [i.cloverId, i]));

        // Fetch clover categories to map itemId -> categoryName
        const catMap = new Map();
        try {
            const url = `https://api.clover.com/v3/merchants/${CLOVER_MERCHANT_ID}/categories?expand=items&limit=1000`;
            const catRes = await fetch(url, { headers: { 'Authorization': `Bearer ${CLOVER_TOKEN}`, 'Content-Type': 'application/json' } });
            const catData = await catRes.json();
            if (catData.elements) {
                catData.elements.forEach((c: any) => {
                    if (c.items?.elements) {
                        c.items.elements.forEach((i: any) => catMap.set(i.id, c.name));
                    }
                });
            }
        } catch (e) { }

        // 3. Fetch Orders from last 3 days
        const limit = 100;
        let offset = 0;
        let hasMore = true;
        const cloverThreeDaysAgoMillis = threeDaysAgo.getTime();
        let newlyProcessedCount = 0;

        while (hasMore) {
            const url = `https://api.clover.com/v3/merchants/${CLOVER_MERCHANT_ID}/orders?expand=lineItems,lineItems.modifications&filter=createdTime>=${cloverThreeDaysAgoMillis}&limit=${limit}&offset=${offset}`;
            const res = await fetch(url, { headers: { 'Authorization': `Bearer ${CLOVER_TOKEN}`, 'Content-Type': 'application/json' } });
            if (!res.ok) break;

            const data = await res.json();
            const orders = data.elements || [];

            for (const order of orders) {
                if (!order.lineItems?.elements) continue;

                for (const li of order.lineItems.elements) {
                    if (!li.id || !li.item?.id) continue;
                    const orderDate = order.createdTime ? new Date(order.createdTime) : new Date();

                    // Check uniqueness
                    const exists = await prisma.processedCloverLineItem.findUnique({
                        where: { cloverLineItemId: li.id }
                    });
                    if (exists) continue; // Skip

                    const cloverItemId = li.item.id;
                    const itemName = li.name || 'Unknown Item';
                    let categoryName = catMap.get(cloverItemId) || 'Uncategorized';

                    // Create Line Item Log for Sales Audit
                    const loggedLineItem = await prisma.processedCloverLineItem.create({
                        data: {
                            cloverLineItemId: li.id,
                            orderId: order.id,
                            itemName,
                            categoryName,
                            createdTime: orderDate,
                            qty: 1
                        }
                    });

                    // Log Modifiers for Audit Board globally (regardless of mapping)
                    if (li.modifications?.elements) {
                        for (const mod of li.modifications.elements) {
                            if (!mod.modifier?.id) continue;
                            await prisma.processedCloverModifier.create({
                                data: {
                                    cloverModifierId: mod.id, // instance ID for uniqueness
                                    lineItemId: loggedLineItem.id,
                                    modifierName: mod.name,
                                    qty: 1
                                }
                            }).catch(() => null);
                        }
                    }

                    // Depletion logic - Menu mapping
                    const mappedMenu = menuItemsByCloverId.get(cloverItemId);
                    if (mappedMenu) {
                        // Deplete base ingredients
                        for (const reqIng of mappedMenu.recipeIngredients) {
                            await depleteInventory(reqIng.ingredientId, reqIng.quantity, `Menu Sale: ${itemName}`);
                        }

                        // Process Modifiers Inventory Deletions
                        if (li.modifications?.elements) {
                            for (const mod of li.modifications.elements) {
                                if (!mod.modifier?.id) continue;

                                // Check map
                                const dbModifier = mappedMenu.modifiers.find((m: any) => m.cloverModifierId === mod.modifier.id);
                                if (dbModifier) {
                                    for (const modIng of dbModifier.ingredients) {
                                        await depleteInventory(modIng.ingredientId, modIng.quantity, `Modifier: ${mod.name}`);
                                    }
                                }
                            }
                        }
                    } else {
                        // Fallback to legacy single ingredient mapping
                        const mappedIng = ingredientsByCloverId.get(cloverItemId);
                        if (mappedIng) {
                            const qtyToDeduct = mappedIng.mappingMultiplier || 1;
                            await depleteInventory(mappedIng.id, qtyToDeduct, `Legacy Sale: ${itemName}`);
                        }
                    }

                    newlyProcessedCount++;
                }
            }

            if (data.elements?.length < limit) {
                hasMore = false;
            } else {
                offset += limit;
            }
        }

        return { success: true, count: newlyProcessedCount };
    } catch (error) {
        console.error("Clover Sync failed:", error);
        return { success: false, error: 'Clover Sync failed' };
    }
}

export async function getLastSyncTime() {
    try {
        const lastLog = await prisma.processedCloverLineItem.findFirst({
            orderBy: { processedAt: 'desc' }
        });
        return lastLog ? lastLog.processedAt.toISOString() : null;
    } catch (e) {
        return null;
    }
}
