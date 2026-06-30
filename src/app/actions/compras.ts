'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';

export async function getComprasIngredients(providerNames: string[]) {
    try {
        const ingredients = await prisma.ingredient.findMany({
            where: {
                type: 'RAW',
                parentId: null,
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
            data: { needsOrdering }
        });
        revalidatePath('/[locale]/compras', 'page');
        return { success: true };
    } catch (e: any) {
        console.error('Error toggling needs ordering:', e);
        return { success: false, error: e.message };
    }
}

export async function setPurchaseStatus(id: string, status: string) {
    try {
        const validStatuses = ['PENDIENTE', 'COMPRADO', 'NO_DISPONIBLE'];
        if (!validStatuses.includes(status)) {
            return { success: false, error: 'Invalid purchase status' };
        }
        await prisma.ingredient.update({
            where: { id },
            data: { purchaseStatus: status }
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
        await prisma.ingredient.updateMany({
            where: {
                provider: { name: { in: providerNames } },
                isSubmittedForOrdering: true
            },
            data: { 
                needsOrdering: false,
                isSubmittedForOrdering: false
            }
        });
        revalidatePath('/[locale]/compras', 'page');
        return { success: true };
    } catch (e: any) {
        console.error('Error completing shopping list:', e);
        return { success: false, error: e.message };
    }
}
