'use server';

import prisma from '@/lib/prisma';

function requireCloverEnv(name: 'CLOVER_MERCHANT_ID' | 'CLOVER_API_TOKEN'): string {
    const value = process.env[name];
    if (!value) {
        throw new Error('Faltan las credenciales de Clover (CLOVER_MERCHANT_ID / CLOVER_API_TOKEN) en las variables de entorno');
    }
    return value;
}

async function depleteInventory(ingredientId: string, quantity: number, note: string) {
    const inv = await prisma.inventory.findUnique({ where: { ingredientId: ingredientId } });
    if (!inv) return;

    let newThawing = inv.thawingQty;
    let newFrozen = inv.frozenQty;
    let remainingToDeduct = quantity;

    // 1. Calculate FIFO buckets from Descongelado first
    if (newThawing >= remainingToDeduct) {
        newThawing -= remainingToDeduct;
        remainingToDeduct = 0;
    } else {
        remainingToDeduct -= newThawing;
        newThawing = 0;
    }

    // 2. Any leftover deduction comes out of Congelado
    if (remainingToDeduct > 0) {
        newFrozen -= remainingToDeduct;
    }

    // 3. Perform DB deductions onto the strict Inventory tracker
    await prisma.inventory.update({
        where: { ingredientId: ingredientId },
        data: {
            thawingQty: newThawing,
            frozenQty: newFrozen
        }
    }).catch(() => null);

    const deductedUnfrozen = inv.thawingQty - newThawing;
    const deductedTotal = inv.frozenQty - newFrozen;

    // 3. Log comprehensive transaction
    const expandedNote = `${note} (FIFO -> Descongelado: -${deductedUnfrozen}, Congelado: -${deductedTotal})`;
    await prisma.inventoryTransaction.create({
        data: { ingredientId: ingredientId, type: 'SALES_DEDUCT_CLOVER', qty: quantity, note: expandedNote }
    }).catch(() => null);
}

async function cloverFetch(path: string, opts: RequestInit = {}) {
    const CLOVER_MERCHANT_ID = requireCloverEnv('CLOVER_MERCHANT_ID');
    const CLOVER_TOKEN = requireCloverEnv('CLOVER_API_TOKEN');
    const url = `https://api.clover.com/v3/merchants/${CLOVER_MERCHANT_ID}${path}`;
    const headers = { 'Authorization': `Bearer ${CLOVER_TOKEN}`, 'Content-Type': 'application/json' };
    for (let attempt = 1; attempt <= 4; attempt++) {
        const res = await fetch(url, { ...opts, headers });
        if (res.status === 429) {
            await new Promise(r => setTimeout(r, attempt * 2000));
            continue;
        }
        if (!res.ok) throw new Error(`Clover ${opts.method || 'GET'} ${path} -> ${res.status}: ${await res.text()}`);
        return res.json();
    }
    throw new Error(`Clover ${path}: rate limited (429) after retries`);
}

/**
 * Fetch a linked Clover item's live details. Clover is the source of truth
 * for linked menu items: the app mirrors name, price and category from here.
 * Returns null (non-fatal) if Clover is unreachable.
 */
export async function fetchCloverItemDetails(cloverId: string): Promise<{
    name: string;
    price: number;          // dollars
    description: string;
    category: string | null;
} | null> {
    try {
        const item = await cloverFetch(`/items/${cloverId}?expand=categories`);
        return {
            name: item.name || '',
            price: (item.price || 0) / 100,
            description: item.description || '',
            category: item.categories?.elements?.[0]?.name || null
        };
    } catch (e) {
        console.error('fetchCloverItemDetails failed:', e);
        return null;
    }
}

/**
 * Update the description of a Clover item (managed from the app's menu modal).
 * Non-fatal: callers should not fail the DB save if Clover is unreachable.
 */
export async function updateCloverItemDescription(cloverId: string, description: string) {
    try {
        await cloverFetch(`/items/${cloverId}`, {
            method: 'POST',
            body: JSON.stringify({ description })
        });
        return { success: true };
    } catch (e) {
        console.error('updateCloverItemDescription failed:', e);
        return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
}

export async function fetchCloverMenuItems() {
    const CLOVER_MERCHANT_ID = requireCloverEnv('CLOVER_MERCHANT_ID');
    const CLOVER_TOKEN = requireCloverEnv('CLOVER_API_TOKEN');
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

/**
 * Read-only Clover item list for the Salón stock module. Unlike
 * fetchCloverMenuItems (which returns only id/name via a bare fetch), this goes
 * through cloverFetch so it inherits the 429 retry, and it preserves the fields
 * the Salón UI needs — notably stockCount, which stays null when Clover omits
 * it rather than being flattened to 0.
 *
 * Writes nothing to Clover and nothing to the database.
 */
export async function fetchCloverItemsForSalon(): Promise<{
    items: {
        id: string;
        name: string;
        price: number;            // raw integer cents, as Clover sends it
        stockCount: number | null; // null = Clover omitted the field
        autoManage: boolean;
        available: boolean;
        hidden: boolean;
        deleted: boolean;
        sku: string | null;
        categoryName: string | null;
    }[];
    alreadyLinked: string[];
    error: string | null;
}> {
    let error: string | null = null;

    // Which Clover ids are already claimed by an Ingredient row.
    let alreadyLinked: string[] = [];
    try {
        const linked = await prisma.ingredient.findMany({
            where: { cloverId: { not: null } },
            select: { cloverId: true }
        });
        alreadyLinked = linked.map(i => i.cloverId as string);
    } catch (e) {
        error = `No se pudieron leer los ingredientes vinculados: ${e instanceof Error ? e.message : String(e)}`;
    }

    let rawItems: any[] = [];
    try {
        const data = await cloverFetch('/items?limit=1000');
        rawItems = data.elements || [];
    } catch (e) {
        const msg = `No se pudieron obtener los artículos de Clover: ${e instanceof Error ? e.message : String(e)}`;
        return { items: [], alreadyLinked, error: error ? `${error} | ${msg}` : msg };
    }

    // itemId -> categoryName, same shape as syncCloverSales builds. A failure
    // here is reported rather than swallowed: items still come back, with
    // categoryName null across the board.
    const catMap = new Map<string, string>();
    try {
        const catData = await cloverFetch('/categories?expand=items&limit=1000');
        for (const c of catData.elements || []) {
            for (const i of c.items?.elements || []) {
                catMap.set(i.id, c.name);
            }
        }
    } catch (e) {
        const msg = `No se pudieron obtener las categorías de Clover: ${e instanceof Error ? e.message : String(e)}`;
        error = error ? `${error} | ${msg}` : msg;
    }

    const items = rawItems
        .filter((el: any) => el.deleted !== true)
        .map((el: any) => ({
            id: el.id,
            name: el.name || '',
            price: typeof el.price === 'number' ? el.price : 0,
            stockCount: typeof el.stockCount === 'number' ? el.stockCount : null,
            autoManage: el.autoManage === true,
            available: el.available === true,
            hidden: el.hidden === true,
            deleted: el.deleted === true,
            sku: el.sku || null,
            categoryName: catMap.get(el.id) ?? null
        }));

    return { items, alreadyLinked, error };
}

export async function fetchCloverModifiers() {
    const CLOVER_MERCHANT_ID = requireCloverEnv('CLOVER_MERCHANT_ID');
    const CLOVER_TOKEN = requireCloverEnv('CLOVER_API_TOKEN');
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
    const CLOVER_MERCHANT_ID = requireCloverEnv('CLOVER_MERCHANT_ID');
    const CLOVER_TOKEN = requireCloverEnv('CLOVER_API_TOKEN');
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

/**
 * Push one salón item's name, price and front-of-house count to Clover, then
 * read both records back so the caller sees what Clover actually stored rather
 * than what was sent.
 *
 * Only qtyFront is written to stockCount — the bodega count is deliberately
 * excluded, since Clover tracks what is sellable on the floor.
 */
export async function pushSalonItemToClover(ingredientId: string): Promise<{
    success: boolean;
    error: string | null;
    echo: {
        name: string;
        price: number;
        stockCount: number | null;
        available: boolean;
        autoManage: boolean;
    } | null;
}> {
    let ingredient;
    try {
        ingredient = await prisma.ingredient.findUnique({
            where: { id: ingredientId },
            include: { salonStock: true }
        });
    } catch (e) {
        return {
            success: false,
            error: `No se pudo leer el ingrediente: ${e instanceof Error ? e.message : String(e)}`,
            echo: null
        };
    }

    if (!ingredient) {
        return { success: false, error: 'No se encontró el ingrediente.', echo: null };
    }
    if (!ingredient.salonStock) {
        return {
            success: false,
            error: 'Este producto no tiene fila de stock del salón. Guárdalo primero desde el salón.',
            echo: null
        };
    }
    if (!ingredient.cloverId) {
        return {
            success: false,
            error: 'Este producto no está vinculado a Clover (falta el cloverId).',
            echo: null
        };
    }

    const cloverId = ingredient.cloverId;
    const stock = ingredient.salonStock;

    // Step 1 — name and price. salePrice is already integer cents, sent as-is.
    try {
        await cloverFetch(`/items/${cloverId}`, {
            method: 'POST',
            body: JSON.stringify({ name: ingredient.name, price: stock.salePrice })
        });
    } catch (e) {
        return {
            success: false,
            error: `Falló el envío de nombre y precio a Clover: ${e instanceof Error ? e.message : String(e)}`,
            echo: null
        };
    }

    // Step 2 — front-of-house count only.
    try {
        await cloverFetch(`/item_stocks/${cloverId}`, {
            method: 'POST',
            body: JSON.stringify({ stockCount: stock.qtyFront })
        });
    } catch (e) {
        return {
            success: false,
            error: `Falló el envío del stock a Clover: ${e instanceof Error ? e.message : String(e)}`,
            echo: null
        };
    }

    // Step 3 — read back the item.
    let itemBack: any;
    try {
        itemBack = await cloverFetch(`/items/${cloverId}`);
    } catch (e) {
        return {
            success: false,
            error: `Los datos se enviaron, pero falló la lectura del artículo en Clover: ${e instanceof Error ? e.message : String(e)}`,
            echo: null
        };
    }

    // Step 4 — read back the stock record.
    let stockBack: any;
    try {
        stockBack = await cloverFetch(`/item_stocks/${cloverId}`);
    } catch (e) {
        return {
            success: false,
            error: `Los datos se enviaron, pero falló la lectura del stock en Clover: ${e instanceof Error ? e.message : String(e)}`,
            echo: null
        };
    }

    const echo = {
        name: itemBack?.name || '',
        price: typeof itemBack?.price === 'number' ? itemBack.price : 0,
        stockCount: typeof stockBack?.stockCount === 'number' ? stockBack.stockCount : null,
        available: itemBack?.available === true,
        autoManage: itemBack?.autoManage === true
    };

    try {
        await prisma.salonStock.update({
            where: { ingredientId },
            data: { lastCloverSyncAt: new Date() }
        });
    } catch (e) {
        return {
            success: false,
            error: `Clover se actualizó, pero no se pudo guardar la fecha de sincronización: ${e instanceof Error ? e.message : String(e)}`,
            echo
        };
    }

    return { success: true, error: null, echo };
}

/**
 * TEMPORARY read-only probe: three ways of reading the same stock number for
 * Coca Cola Diet, to establish which endpoint actually reports what the Clover
 * dashboard shows. Three GETs, no POST or PUT — writes nothing to Clover and
 * nothing to the database.
 */
export async function probeCocaColaStockReads(): Promise<{
    itemStockRaw: any;
    itemStockError: string | null;
    itemStockCount: number | null;
    itemError: string | null;
    expandRaw: any;
    expandError: string | null;
}> {
    // a) the dedicated stock record
    let itemStockRaw: any = null;
    let itemStockError: string | null = null;
    try {
        itemStockRaw = await cloverFetch('/item_stocks/2JJ8XPD1480JJ');
    } catch (e) {
        itemStockError = e instanceof Error ? e.message : String(e);
    }

    // b) stockCount as reported on the item itself
    let itemStockCount: number | null = null;
    let itemError: string | null = null;
    try {
        const item = await cloverFetch('/items/2JJ8XPD1480JJ');
        itemStockCount = typeof item?.stockCount === 'number' ? item.stockCount : null;
    } catch (e) {
        itemError = e instanceof Error ? e.message : String(e);
    }

    // c) the item with its stock relation expanded
    let expandRaw: any = null;
    let expandError: string | null = null;
    try {
        expandRaw = await cloverFetch('/items/2JJ8XPD1480JJ?expand=itemStock');
    } catch (e) {
        expandError = e instanceof Error ? e.message : String(e);
    }

    return { itemStockRaw, itemStockError, itemStockCount, itemError, expandRaw, expandError };
}

/**
 * TEMPORARY read-only probe: inspects what Clover currently holds for the Inca
 * Kola Diet item. Two GETs, no POST or PUT — writes nothing to Clover and
 * nothing to the database.
 */
export async function probeCloverStockWrite(): Promise<{
    itemStockRaw: any;
    itemStockError: string | null;
    itemStockCount: number | null;
    itemAvailable: boolean | null;
    itemError: string | null;
}> {
    let itemStockRaw: any = null;
    let itemStockError: string | null = null;
    try {
        itemStockRaw = await cloverFetch('/item_stocks/AS7W11RAMW4CW');
    } catch (e) {
        itemStockError = e instanceof Error ? e.message : String(e);
    }

    let itemStockCount: number | null = null;
    let itemAvailable: boolean | null = null;
    let itemError: string | null = null;
    try {
        const item = await cloverFetch('/items/AS7W11RAMW4CW');
        itemStockCount = typeof item?.stockCount === 'number' ? item.stockCount : null;
        itemAvailable = typeof item?.available === 'boolean' ? item.available : null;
    } catch (e) {
        itemError = e instanceof Error ? e.message : String(e);
    }

    return { itemStockRaw, itemStockError, itemStockCount, itemAvailable, itemError };
}

/**
 * TEMPORARY read-only probe for the salon-debug page. Two GETs, nothing else:
 * writes nothing to Clover and nothing to the database. Each call is isolated
 * so one failing still reports the other. cloverFetch throws with the HTTP
 * status and response body already in the message, so the raw message is kept
 * verbatim rather than being reworded.
 */
export async function probeCloverStockEndpoints(): Promise<{
    itemStocks: any;
    itemStocksError: string | null;
    incaKolaDiet: any;
    incaKolaDietError: string | null;
}> {
    let itemStocks: any = null;
    let itemStocksError: string | null = null;
    try {
        itemStocks = await cloverFetch('/item_stocks?limit=100');
    } catch (e) {
        itemStocksError = e instanceof Error ? e.message : String(e);
    }

    let incaKolaDiet: any = null;
    let incaKolaDietError: string | null = null;
    try {
        incaKolaDiet = await cloverFetch('/items/AS7W11RAMW4CW');
    } catch (e) {
        incaKolaDietError = e instanceof Error ? e.message : String(e);
    }

    return { itemStocks, itemStocksError, incaKolaDiet, incaKolaDietError };
}

/**
 * Import the requested Clover items as Salón ingredients. Reads Clover through
 * fetchCloverItemsForSalon and writes only to the database — nothing is sent
 * back to Clover.
 *
 * Every item is isolated in its own try/catch: a single bad row is recorded in
 * `skipped` and the rest of the batch still lands.
 */
export async function importSalonDrinksFromClover(cloverIds: string[]): Promise<{
    created: number;
    updated: number;
    skipped: { name: string; reason: string }[];
}> {
    let created = 0;
    let updated = 0;
    const skipped: { name: string; reason: string }[] = [];

    // Prisma's unique-constraint violation, narrowed to the Ingredient.name index.
    const isDuplicateNameError = (e: any) =>
        e?.code === 'P2002' && JSON.stringify(e?.meta?.target ?? '').includes('name');

    const { items, error } = await fetchCloverItemsForSalon();
    if (items.length === 0) {
        const reason = error ?? 'Clover no devolvió artículos';
        return { created, updated, skipped: cloverIds.map(id => ({ name: id, reason })) };
    }

    const byId = new Map(items.map(i => [i.id, i]));

    // One category for the whole batch, created before the loop and reused.
    let categoryId: string;
    try {
        const existingCategory = await prisma.category.findFirst({
            where: { name: 'Bebidas Salón', type: 'INGREDIENT' }
        });
        categoryId = existingCategory
            ? existingCategory.id
            : (await prisma.category.create({
                data: {
                    name: 'Bebidas Salón',
                    nameEs: 'Bebidas Salón',
                    type: 'INGREDIENT',
                    department: 'DRINKS'
                }
            })).id;
    } catch (e) {
        const reason = `No se pudo preparar la categoría Bebidas Salón: ${e instanceof Error ? e.message : String(e)}`;
        return { created, updated, skipped: cloverIds.map(id => ({ name: id, reason })) };
    }

    for (const cloverId of cloverIds) {
        const item = byId.get(cloverId);
        try {
            if (!item) {
                skipped.push({ name: cloverId, reason: 'No se encontró el artículo en Clover' });
                continue;
            }

            // cloverId is not unique in the schema, so this is a findFirst.
            const existing = await prisma.ingredient.findFirst({ where: { cloverId } });

            let ingredientId: string;
            if (existing) {
                await prisma.ingredient.update({
                    where: { id: existing.id },
                    data: { name: item.name }
                });
                ingredientId = existing.id;
                updated++;
            } else {
                try {
                    const ingredient = await prisma.ingredient.create({
                        data: {
                            name: item.name,
                            cloverId,
                            categoryId,
                            type: 'RAW',
                            isSalonItem: true,
                            showInKitchen: false,
                            isActive: true,
                            metric: 'units',
                            parentId: null
                        }
                    });
                    ingredientId = ingredient.id;
                    created++;
                } catch (e) {
                    if (isDuplicateNameError(e)) {
                        skipped.push({ name: item.name, reason: 'Ya existe un ingrediente con ese nombre' });
                        continue;
                    }
                    throw e;
                }
            }

            // Quantities on an existing row are the salón's live counts — only
            // the price is refreshed from Clover.
            const stock = await prisma.salonStock.findUnique({ where: { ingredientId } });
            if (stock) {
                await prisma.salonStock.update({
                    where: { ingredientId },
                    data: { salePrice: item.price }
                });
            } else {
                await prisma.salonStock.create({
                    data: {
                        ingredientId,
                        qtyFront: 0,
                        qtyBodega: 0,
                        parFront: 0,
                        unitsPerPack: 24,
                        cloverItemId: cloverId,
                        salePrice: item.price
                    }
                });
            }
        } catch (e) {
            skipped.push({
                name: item?.name || cloverId,
                reason: isDuplicateNameError(e)
                    ? 'Ya existe un ingrediente con ese nombre'
                    : (e instanceof Error ? e.message : String(e))
            });
        }
    }

    return { created, updated, skipped };
}
