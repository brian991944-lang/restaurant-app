'use server';

import prisma from '@/lib/prisma';

export async function getTeamMembers() {
    return prisma.user.findMany({
        where: { role: 'KITCHEN' },
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
        where: { type: 'PREP' },
        include: { category: true, _count: { select: { usedInPreps: true } } }
    });
}

export async function addPrepTaskItem(name: string, categoryId: string, metric: string) {
    try {
        // Find 'Prep' in Types. If not exist, fallback.
        const item = await prisma.ingredient.create({
            data: {
                name,
                categoryId,
                type: 'PREP',
                metric,
                currentPrice: 0,
                yieldPercent: 100
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
