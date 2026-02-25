'use server';

import prisma from '@/lib/prisma';

export async function getAssignmentsForDate(targetDate: Date) {
    const startOfDay = new Date(targetDate);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(targetDate);
    endOfDay.setHours(23, 59, 59, 999);

    const schedules = await prisma.schedule.findMany({
        where: {
            date: { gte: startOfDay, lte: endOfDay }
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

export async function assignNightShiftTasks(tasks: { ingredientId: string, qty: number, userId?: string, urgent?: boolean }[], targetDate?: Date) {
    try {
        const assignFor = targetDate || new Date(new Date().setDate(new Date().getDate() + 1));
        assignFor.setHours(12, 0, 0, 0);

        // Find or create schedule for the date
        let schedule = await prisma.schedule.findFirst({
            where: {
                date: {
                    gte: new Date(new Date(assignFor).setHours(0, 0, 0, 0)),
                    lte: new Date(new Date(assignFor).setHours(23, 59, 59, 999))
                }
            }
        });

        if (!schedule) {
            schedule = await prisma.schedule.create({
                data: {
                    date: assignFor,
                    createdBy: 'NightShift',
                    assignedTo: 'MorningCrew'
                }
            });
        }

        // We could default to the first kitchen user if none provided, or just let them be dummy attached for now.
        // Actually the schema requires userId on PrepAssignment. Let's find a default user.
        let defaultUser = await prisma.user.findFirst({ where: { role: 'KITCHEN' } });
        if (!defaultUser) defaultUser = await prisma.user.findFirst();

        for (const t of tasks) {
            // Delete existing assignment for this ingredient if any
            await prisma.prepAssignment.deleteMany({
                where: { scheduleId: schedule.id, ingredientId: t.ingredientId }
            });

            if (t.qty > 0) {
                await prisma.prepAssignment.create({
                    data: {
                        scheduleId: schedule.id,
                        userId: t.userId || defaultUser!.id,
                        ingredientId: t.ingredientId,
                        portionsAssigned: t.qty,
                        completed: false,
                        isUrgent: t.urgent || false
                    }
                });
            }
        }

        return { success: true };
    } catch (e: any) {
        console.error(e);
        return { success: false, error: e.message };
    }
}
