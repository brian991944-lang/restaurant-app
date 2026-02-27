'use server';

import prisma from '@/lib/prisma';

export async function getAssignmentsForDate(targetDate: Date) {
    const estFormatted = targetDate.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const startOfDay = new Date(`${estFormatted}T00:00:00-05:00`);
    const endOfDay = new Date(`${estFormatted}T23:59:59.999-05:00`);

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
        const assignFor = targetDate || new Date();
        const estFormatted = assignFor.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
        const startOfDay = new Date(`${estFormatted}T00:00:00-05:00`);
        const endOfDay = new Date(`${estFormatted}T23:59:59.999-05:00`);

        // Find or create schedule for the date
        let schedule = await prisma.schedule.findFirst({
            where: {
                date: {
                    gte: startOfDay,
                    lte: endOfDay
                }
            }
        });

        if (!schedule) {
            schedule = await prisma.schedule.create({
                data: {
                    date: new Date(`${estFormatted}T12:00:00-05:00`),
                    createdBy: 'NightShift',
                    assignedTo: 'MorningCrew'
                }
            });
        }

        // Get dummy user 'Any Cook'
        let anyCook = await prisma.user.findFirst({ where: { email: 'anycook@system.local' } });
        if (!anyCook) {
            anyCook = await prisma.user.create({ data: { name: 'Any Cook', email: 'anycook@system.local', role: 'KITCHEN' } });
        }

        for (const t of tasks) {
            // Delete existing assignment for this ingredient if any
            await prisma.prepAssignment.deleteMany({
                where: { scheduleId: schedule.id, ingredientId: t.ingredientId }
            });

            await prisma.prepAssignment.create({
                data: {
                    scheduleId: schedule.id,
                    userId: (t.userId && t.userId !== 'ANY') ? t.userId : anyCook.id,
                    ingredientId: t.ingredientId,
                    portionsAssigned: t.qty || 0,
                    completed: false,
                    isUrgent: t.urgent || false
                }
            });
        }

        return { success: true };
    } catch (e: any) {
        console.error(e);
        return { success: false, error: e.message };
    }
}
