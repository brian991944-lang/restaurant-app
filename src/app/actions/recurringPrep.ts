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
