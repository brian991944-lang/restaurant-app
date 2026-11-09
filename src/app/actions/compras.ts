'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

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
                }
            },
            orderBy: {
                name: 'asc'
            }
        });
        return { success: true, data: ingredients };
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
