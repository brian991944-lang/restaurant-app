'use server';

import prisma from '@/lib/prisma';

export async function getRecurringRules() {
    return prisma.recurringPrepRule.findMany({
        include: {
            ingredient: {
                select: { id: true, name: true, metric: true, category: { select: { name: true } } }
            },
            baseIngredient: {
                select: { id: true, name: true, metric: true }
            }
        },
        orderBy: [{ dayOfWeek: 'asc' }]
    });
}

export async function createRecurringRule(ingredientId: string, dayOfWeek: number, amount: number, baseIngredientId: string) {
    try {
        await prisma.recurringPrepRule.create({
            data: { ingredientId, dayOfWeek, amount, baseIngredientId }
        });
        return { success: true };
    } catch (e: any) {
        console.error(e);
        return { success: false, error: e.message };
    }
}

export async function deleteRecurringRule(id: string) {
    try {
        await prisma.recurringPrepRule.delete({ where: { id } });
        return { success: true };
    } catch (e: any) {
        return { success: false, error: e.message };
    }
}

export async function getThawableIngredients() {
    return prisma.ingredient.findMany({
        where: { trackFreezerStatus: true },
        select: {
            id: true,
            name: true,
            nameEs: true,
            metric: true,
            cookAssignmentOverride: true,
            category: { select: { id: true, name: true, cookAssignment: true } },
        },
        orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }],
    });
}

export async function upsertRecurringRule(
    ingredientId: string,
    dayOfWeek: number,
    amount: number,
    mode: 'MANUAL' | 'ALGORITHM' = 'MANUAL',
): Promise<{ success: boolean; error?: string }> {
    try {
        if (!amount || amount <= 0) {
            await prisma.recurringPrepRule.deleteMany({ where: { ingredientId, dayOfWeek } });
        } else {
            // TODO: compute from sales when algorithm is implemented
            await prisma.recurringPrepRule.upsert({
                where: { ingredientId_dayOfWeek: { ingredientId, dayOfWeek } },
                create: { ingredientId, dayOfWeek, amount, mode },
                update: { amount, mode },
            });
        }
        return { success: true };
    } catch (e: any) {
        console.error('upsertRecurringRule failed:', e);
        return { success: false, error: e.message ?? 'Error al guardar' };
    }
}

export async function updateCategoryCookAssignment(
    categoryId: string,
    cook: 1 | 2,
): Promise<{ success: boolean; error?: string }> {
    try {
        await prisma.category.update({
            where: { id: categoryId },
            data: { cookAssignment: cook },
        });
        return { success: true };
    } catch (e: any) {
        console.error('updateCategoryCookAssignment failed:', e);
        return { success: false, error: e.message ?? 'Error al guardar' };
    }
}

export async function updateIngredientCookOverride(
    ingredientId: string,
    cook: 1 | 2 | null,
): Promise<{ success: boolean; error?: string }> {
    try {
        await prisma.ingredient.update({
            where: { id: ingredientId },
            data: { cookAssignmentOverride: cook },
        });
        return { success: true };
    } catch (e: any) {
        console.error('updateIngredientCookOverride failed:', e);
        return { success: false, error: e.message ?? 'Error al guardar' };
    }
}
