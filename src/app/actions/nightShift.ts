'use server';

import prisma from '@/lib/prisma';

export async function getTomorrowAssignments() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const endTomorrow = new Date(tomorrow);
    endTomorrow.setHours(23, 59, 59, 999);

    const schedules = await prisma.schedule.findMany({
        where: {
            date: { gte: tomorrow, lte: endTomorrow }
        },
        include: {
            prepAssignments: {
                include: {
                    ingredient: {
                        select: { name: true, category: { select: { name: true } } }
                    }
                }
            }
        }
    });

    const assignments = [];
    for (const s of schedules) {
        for (const a of s.prepAssignments) {
            assignments.push(a);
        }
    }

    return assignments;
}
