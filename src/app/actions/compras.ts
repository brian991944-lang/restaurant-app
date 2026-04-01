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
