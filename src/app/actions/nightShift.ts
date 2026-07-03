'use server';

import prisma from '@/lib/prisma';
import { getBusinessDate, getScheduleAnchorUtc, getScheduleWindowUtc } from '@/lib/businessDay';

export async function getAssignmentsForDate(targetDate: Date) {
    const businessDate = getBusinessDate(targetDate);
    const { start: startOfDay, end: endOfDay } = getScheduleWindowUtc(businessDate);

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

/**
 * Assigns night-shift prep tasks to an EXPLICIT business day.
 *
 * targetDate must be a 'YYYY-MM-DD' string chosen by the caller — there is
 * deliberately NO implicit "today" fallback. On July 1 2026 an evening run
 * with an implicit same-day target attached 15 next-day tasks to July 1's
 * schedule; requiring the target (and re-verifying the resolved schedule's
 * day below) prevents that class of mis-file.
 */
export async function assignNightShiftTasks(
    tasks: { ingredientId: string, qty: number, userId?: string, urgent?: boolean }[],
    targetDate: string
) {
    try {
        if (!targetDate || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
            throw new Error('Falta la fecha de asignación (formato AAAA-MM-DD). Selecciona el día antes de guardar.');
        }

        const { start: startOfDay, end: endOfDay } = getScheduleWindowUtc(targetDate);

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
                    date: getScheduleAnchorUtc(targetDate),
                    createdBy: 'NightShift',
                    assignedTo: 'MorningCrew'
                }
            });
        }

        // Mis-file guard: the resolved schedule MUST belong to the requested
        // business day. Never silently attach tasks to a different day.
        const resolvedDay = getBusinessDate(schedule.date);
        if (resolvedDay !== targetDate) {
            throw new Error(`Conflicto de fechas: se pidió asignar para ${targetDate} pero el horario resuelto es del ${resolvedDay}. No se guardó nada.`);
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
