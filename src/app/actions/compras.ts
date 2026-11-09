'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { isAdminSession } from '@/lib/adminGuard';
import { moveStorage } from '@/app/actions/storage';

export async function getComprasIngredients(providerNames: string[]) {
    try {
        const ingredients = await prisma.ingredient.findMany({
            where: {
                type: 'RAW',
                parentId: null,
                isActive: true,
                provider: {
                    name: {
                        in: providerNames
                    }
                }
            },
            include: {
                provider: true,
                inventory: true,
                category: true,
                // Portioned/processed forms of this raw ingredient (e.g. Camaron Porcionado
                // for Shrimp 51/60), so the shopping list can show the full picture before
                // someone flags a raw item as needing reorder.
                prepItems: {
                    where: { type: 'PROCESSED', isActive: true },
                    include: { inventory: true }
                },
                // Almacén de casa: what is already at Brian's house, so the list
                // can say "llevar de casa" instead of "comprar".
                storageStocks: {
                    where: { location: 'HOME', qty: { gt: 0 } },
                    select: { qty: true, unit: true, totalWeightLb: true },
                    orderBy: { qty: 'desc' }
                }
            },
            orderBy: {
                name: 'asc'
            }
        });
        // Storage quantities are admin-only (see actions/storage.ts); everyone
        // else only learns that the item is at home.
        const admin = await isAdminSession();
        const data = ingredients.map(({ storageStocks, ...ing }) => ({
            ...ing,
            atHome: storageStocks.length > 0,
            homeStock: admin ? storageStocks : [],
        }));
        return { success: true, data };
    } catch (e: any) {
        console.error('Error fetching compras ingredients:', e);
        return { success: false, error: e.message };
    }
}

export async function toggleNeedsOrdering(ingredientId: string, needsOrdering: boolean) {
    try {
        await prisma.ingredient.update({
            where: { id: ingredientId },
            // Unflagging drops the suggestion with it, so a stale number never comes back.
            data: needsOrdering ? { needsOrdering } : { needsOrdering, orderQty: null }
        });
        revalidatePath('/[locale]/compras', 'page');
        return { success: true };
    } catch (e: any) {
        console.error('Error toggling needs ordering:', e);
        return { success: false, error: e.message };
    }
}

// A quantity box value: null clears it; anything else must be a finite number >= 0.
function cleanQty(qty: number | null): number | null | undefined {
    if (qty === null) return null;
    if (typeof qty !== 'number' || !Number.isFinite(qty) || qty < 0) return undefined;
    return qty;
}

/** Suggested quantity, typed by whoever flags the item for ordering. */
export async function setOrderQty(id: string, qty: number | null) {
    try {
        const value = cleanQty(qty);
        if (value === undefined) return { success: false, error: 'Invalid quantity' };
        await prisma.ingredient.update({ where: { id }, data: { orderQty: value } });
        revalidatePath('/[locale]/compras', 'page');
        return { success: true };
    } catch (e: any) {
        console.error('Error setting order qty:', e);
        return { success: false, error: e.message };
    }
}

/** What was actually bought, typed on Lista Enviada. Prefills Recibir. */
export async function setBoughtQty(id: string, qty: number | null) {
    try {
        const value = cleanQty(qty);
        if (value === undefined) return { success: false, error: 'Invalid quantity' };
        await prisma.ingredient.update({ where: { id }, data: { boughtQty: value } });
        revalidatePath('/[locale]/compras', 'page');
        return { success: true };
    } catch (e: any) {
        console.error('Error setting bought qty:', e);
        return { success: false, error: e.message };
    }
}

// boughtQty: the box's value at the moment Comprado is tapped (the suggestion when
// nobody typed over it), so the bought number is saved even if the box was never touched.
export async function setPurchaseStatus(id: string, status: string, boughtQty?: number | null) {
    try {
        const validStatuses = ['PENDIENTE', 'COMPRADO', 'NO_DISPONIBLE'];
        if (!validStatuses.includes(status)) {
            return { success: false, error: 'Invalid purchase status' };
        }
        const qty = boughtQty === undefined ? undefined : cleanQty(boughtQty);
        await prisma.ingredient.update({
            where: { id },
            data: { purchaseStatus: status, ...(status === 'COMPRADO' && qty !== undefined ? { boughtQty: qty } : {}) }
        });
        revalidatePath('/[locale]/compras', 'page');
        return { success: true };
    } catch (e: any) {
        console.error('Error setting purchase status:', e);
        return { success: false, error: e.message };
    }
}
export async function submitShoppingList(providerNames: string[]) {
    try {
        await prisma.ingredient.updateMany({
            where: {
                provider: { name: { in: providerNames } },
                needsOrdering: true
            },
            data: { isSubmittedForOrdering: true }
        });
        revalidatePath('/[locale]/compras', 'page');
        return { success: true };
    } catch (e: any) {
        console.error('Error submitting shopping list:', e);
        return { success: false, error: e.message };
    }
}

export async function completeShoppingList(providerNames: string[]) {
    try {
        await prisma.$transaction([
            // COMPRADO: purchased — drops off the list, reset to a clean pending state.
            prisma.ingredient.updateMany({
                where: {
                    provider: { name: { in: providerNames } },
                    isSubmittedForOrdering: true,
                    purchaseStatus: 'COMPRADO'
                },
                data: {
                    needsOrdering: false,
                    isSubmittedForOrdering: false,
                    purchaseStatus: 'PENDIENTE',
                    carriedOver: false,
                    orderQty: null,
                    boughtQty: null
                }
            }),
            // NO_DISPONIBLE: stays on the list, flagged as carried-over (urgent).
            // Do NOT change needsOrdering / isSubmittedForOrdering.
            prisma.ingredient.updateMany({
                where: {
                    provider: { name: { in: providerNames } },
                    isSubmittedForOrdering: true,
                    purchaseStatus: 'NO_DISPONIBLE'
                },
                data: {
                    purchaseStatus: 'PENDIENTE',
                    carriedOver: true,
                    boughtQty: null // keeps orderQty: still the suggestion for next time
                }
            })
            // PENDIENTE items are intentionally left entirely untouched.
        ]);
        revalidatePath('/[locale]/compras', 'page');
        return { success: true };
    } catch (e: any) {
        console.error('Error completing shopping list:', e);
        return { success: false, error: e.message };
    }
}

/**
 * "Traje del almacén": move qty from the home almacén to the kitchen (same path as
 * Almacén → Llevar → Cocina, so stock is credited once) and take the item off
 * the shopping list with the same clean reset a received item gets.
 */
export async function bringFromHome(input: { ingredientId: string; qty: number; unit: string }) {
    if (!(await isAdminSession())) return { success: false as const, error: 'Solo administración.' };
    const moved = await moveStorage({ ingredientId: input.ingredientId, from: 'HOME', to: 'KITCHEN', qty: input.qty, unit: input.unit });
    if (!moved.success) return moved;
    try {
        await prisma.ingredient.update({
            where: { id: input.ingredientId },
            data: { purchaseStatus: 'PENDIENTE', needsOrdering: false, isSubmittedForOrdering: false, carriedOver: false, orderQty: null, boughtQty: null }
        });
        revalidatePath('/[locale]/compras', 'page');
        return { success: true as const, credited: moved.credited };
    } catch (e: any) {
        console.error('Moved from home but could not clear the list item:', e);
        return { success: false as const, error: e.message };
    }
}
