'use server';

import prisma from '@/lib/prisma';

export async function getPrepUsers() {
    return prisma.user.findMany({
        where: { role: 'KITCHEN' },
        select: { id: true, name: true }
    });
}
