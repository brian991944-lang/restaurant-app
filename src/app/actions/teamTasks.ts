'use server';

import prisma from '@/lib/prisma';

export async function getTeamMembers() {
    return prisma.user.findMany({
        where: { role: 'KITCHEN' },
        orderBy: { name: 'asc' }
    });
}

export async function getBaseIngredients() {
    return prisma.ingredient.findMany({
        where: { type: { in: ['RAW', 'PROCESSED', 'PREP_RECIPE'] } },
        orderBy: { name: 'asc' }
    });
}

export async function addTeamMember(name: string) {
    try {
        const email = `${name.toLowerCase().replace(/[^a-z0-9]/g, '.')}@fusionista.demo`;
        const user = await prisma.user.create({
            data: {
                name,
                email,
                role: 'KITCHEN'
            }
        });
        return { success: true, user };
    } catch (e: any) {
        console.error(e);
        return { success: false, error: e.message };
    }
}

export async function removeTeamMember(id: string) {
    try {
        await prisma.user.delete({ where: { id } });
        return { success: true };
    } catch (e: any) {
        console.error(e);
        return { success: false, error: e.message };
    }
}

export async function getPrepTaskItems() {
    return prisma.ingredient.findMany({
        where: { type: { in: ['PREP', 'TASK'] } }, // Include both PREP and system TASK (Descongelar)
        include: { category: true, parent: true, _count: { select: { usedInPreps: true } } },
        orderBy: [
            { category: { name: 'asc' } },
            { parent: { name: 'asc' } },
            { name: 'asc' }
        ]
    });
}

export async function addPrepTaskItem(name: string, categoryId: string, metric: string, parentId?: string, subtractFromInventory: boolean = false) {
    try {
        let actualMetric = metric;
        if (parentId) {
            const parent = await prisma.ingredient.findUnique({ where: { id: parentId } });
            if (parent) actualMetric = parent.metric;
        }

        // Determine type based on category type if possible, default to PREP
        const category = await prisma.category.findUnique({ where: { id: categoryId } });
        const type = category?.type === 'TASK' ? 'TASK' : 'PREP';

        const item = await prisma.ingredient.create({
            data: {
                name,
                categoryId,
                // @ts-ignore
                type: type,
                metric: actualMetric,
                parentId: parentId || null,
                currentPrice: 0,
                yieldPercent: 100,
                // @ts-ignore
                subtractFromInventory
            }
        });
        return { success: true, item };
    } catch (e: any) {
        console.error(e);
        return { success: false, error: e.message };
    }
}

export async function removePrepTaskItem(id: string) {
    try {
        await prisma.ingredient.delete({ where: { id } });
        return { success: true };
    } catch (e: any) {
        console.error(e);
        return { success: false, error: e.message };
    }
}

export async function editPrepTaskItem(id: string, name: string, categoryId: string, metric: string, parentId?: string, subtractFromInventory: boolean = false) {
    try {
        let actualMetric = metric;
        if (parentId) {
            const parent = await prisma.ingredient.findUnique({ where: { id: parentId } });
            if (parent) actualMetric = parent.metric;
        }

        const item = await prisma.ingredient.update({
            where: { id },
            data: {
                name,
                categoryId,
                metric: actualMetric,
                parentId: parentId || null,
                // @ts-ignore
                subtractFromInventory
            }
        });
        return { success: true, item };
    } catch (e: any) {
        console.error(e);
        return { success: false, error: e.message };
    }
}
