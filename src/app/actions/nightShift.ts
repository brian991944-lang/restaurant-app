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
            const resolvedUserId = (t.userId && t.userId !== 'ANY') ? t.userId : anyCook.id;

            // Look for an existing assignment for this ingredient on this day's schedule,
            // including its completion records.
            const existing = await prisma.prepAssignment.findFirst({
                where: { scheduleId: schedule.id, ingredientId: t.ingredientId },
                include: { completedByCooks: true },
            });

            if (existing) {
                // NEVER delete-and-recreate (that cascade-deletes completion records).
                // If this assignment is already completed, leave it completely untouched.
                const isCompleted = existing.completed || (existing.completedByCooks?.length ?? 0) > 0;
                if (isCompleted) {
                    continue;
                }
                // Pending row: update in place, preserving the row identity. Do NOT set completed.
                await prisma.prepAssignment.update({
                    where: { id: existing.id },
                    data: {
                        userId: resolvedUserId,
                        portionsAssigned: t.qty || 0,
                        isUrgent: t.urgent || false,
                    },
                });
                continue;
            }

            // No existing assignment for this ingredient today — create a fresh one.
            await prisma.prepAssignment.create({
                data: {
                    scheduleId: schedule.id,
                    userId: resolvedUserId,
                    ingredientId: t.ingredientId,
                    portionsAssigned: t.qty || 0,
                    completed: false,
                    isUrgent: t.urgent || false,
                },
            });
        }

        return { success: true };
    } catch (e: any) {
        console.error(e);
        return { success: false, error: e.message };
    }
}
