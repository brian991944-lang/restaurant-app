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
            category: { select: { id: true, name: true } },
        },
        orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }],
    });
}

export async function upsertRecurringRule(
    ingredientId: string,
    dayOfWeek: number,
    amount: number,
): Promise<{ success: boolean; error?: string }> {
    try {
        if (!amount || amount <= 0) {
            // Delete row if it exists; ignore if it doesn't
            await prisma.recurringPrepRule.deleteMany({ where: { ingredientId, dayOfWeek } });
        } else {
            await prisma.recurringPrepRule.upsert({
                where: { ingredientId_dayOfWeek: { ingredientId, dayOfWeek } },
                create: { ingredientId, dayOfWeek, amount },
                update: { amount },
            });
        }
        return { success: true };
    } catch (e: any) {
        console.error('upsertRecurringRule failed:', e);
        return { success: false, error: e.message ?? 'Error al guardar' };
    }
}
