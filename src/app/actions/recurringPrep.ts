'use server';

import prisma from '@/lib/prisma';

export async function getRecurringRules() {
    return prisma.recurringPrepRule.findMany({
        include: {
            ingredient: {
                select: { name: true, category: { select: { name: true } } }
            }
        },
        orderBy: [{ dayOfWeek: 'asc' }]
    });
}
