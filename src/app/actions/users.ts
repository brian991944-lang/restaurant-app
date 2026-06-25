'use server';

import prisma from '@/lib/prisma';

export async function getPrepUsers() {
    return prisma.user.findMany({
        where: { role: 'KITCHEN', isActive: true, email: { not: 'anycook@system.local' } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' }
    });
}
