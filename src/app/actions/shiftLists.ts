'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { getBusinessDate, getBusinessDayOfWeek } from '@/lib/businessDay';

export type ShiftListType = 'APERTURA' | 'CIERRE';

/**
 * Today's ISO weekday (1=Monday … 7=Sunday) for the current business date, so a
 * task tagged for a given day stays visible through the small hours of that
 * shift rather than flipping at civil midnight.
 */
function todayIsoWeekday(): number {
    const dow = getBusinessDayOfWeek(getBusinessDate());
    return dow === 0 ? 7 : dow;
}

function appliesToday(daysOfWeek: string | null, isoDay: number): boolean {
    if (!daysOfWeek) return true;
    return daysOfWeek
        .split(',')
        .map(s => Number(s.trim()))
        .filter(n => Number.isFinite(n))
        .includes(isoDay);
}

/**
 * The sections and tasks for one checklist, already filtered to what applies
 * today, plus today's run if one has been started.
 */
export async function getShiftList(listType: ShiftListType) {
    const businessDate = getBusinessDate();
    const isoDay = todayIsoWeekday();

    const sections = await prisma.shiftSection.findMany({
        where: { listType, isActive: true },
        orderBy: { sortOrder: 'asc' },
        include: {
            tasks: {
                where: { isActive: true },
                orderBy: { sortOrder: 'asc' }
            }
        }
    });

    // Day filtering is done here rather than in the query: daysOfWeek is a
    // comma string, which Prisma cannot match numerically.
    const filtered = sections.map(section => ({
        ...section,
        tasks: section.tasks.filter(t => appliesToday(t.daysOfWeek, isoDay))
    }));

    const run = await prisma.shiftRun.findUnique({
        where: { listType_businessDate: { listType, businessDate } },
        include: { checks: true, staff: true }
    });

    return { sections: filtered, run, businessDate };
}

/**
 * Everything in a list for the admin editor: inactive sections and tasks
 * included, and no day filtering — the editor has to show what it can edit.
 */
export async function getAllShiftSections(listType: string) {
    return prisma.shiftSection.findMany({
        where: { listType },
        orderBy: { sortOrder: 'asc' },
        include: { tasks: { orderBy: { sortOrder: 'asc' } } }
    });
}

export async function createShiftTask(
    sectionId: string,
    text: string
): Promise<{ success: boolean; error?: string }> {
    const trimmed = text.trim();
    if (!trimmed) return { success: false, error: 'El texto de la tarea no puede estar vacío.' };

    try {
        const last = await prisma.shiftTask.findFirst({
            where: { sectionId },
            orderBy: { sortOrder: 'desc' },
            select: { sortOrder: true }
        });

        await prisma.shiftTask.create({
            data: { sectionId, text: trimmed, sortOrder: (last?.sortOrder ?? -1) + 1 }
        });

        revalidatePath('/[locale]/closing-lists');
        return { success: true };
    } catch (e) {
        console.error('Failed to create shift task:', e);
        return { success: false, error: 'No se pudo crear la tarea.' };
    }
}

export async function updateShiftTask(
    taskId: string,
    data: { text?: string; daysOfWeek?: string | null; isActive?: boolean; sectionId?: string }
): Promise<{ success: boolean; error?: string }> {
    if (data.text !== undefined && !data.text.trim()) {
        return { success: false, error: 'El texto de la tarea no puede estar vacío.' };
    }

    try {
        await prisma.shiftTask.update({
            where: { id: taskId },
            data: {
                text: data.text !== undefined ? data.text.trim() : undefined,
                // null is meaningful here (every day), so only `undefined` skips.
                daysOfWeek: data.daysOfWeek !== undefined ? data.daysOfWeek : undefined,
                isActive: data.isActive !== undefined ? data.isActive : undefined,
                sectionId: data.sectionId !== undefined ? data.sectionId : undefined
            }
        });

        revalidatePath('/[locale]/closing-lists');
        return { success: true };
    } catch (e) {
        console.error('Failed to update shift task:', e);
        return { success: false, error: 'No se pudo guardar la tarea.' };
    }
}

export async function deleteShiftTask(taskId: string): Promise<{ success: boolean; error?: string }> {
    try {
        // Checks and deferrals cascade from the schema.
        await prisma.shiftTask.delete({ where: { id: taskId } });
        revalidatePath('/[locale]/closing-lists');
        return { success: true };
    } catch (e) {
        console.error('Failed to delete shift task:', e);
        return { success: false, error: 'No se pudo borrar la tarea.' };
    }
}

export async function reorderShiftTask(
    taskId: string,
    direction: 'UP' | 'DOWN'
): Promise<{ success: boolean; error?: string }> {
    try {
        const task = await prisma.shiftTask.findUnique({ where: { id: taskId } });
        if (!task) return { success: false, error: 'No se encontró la tarea.' };

        const neighbour = await prisma.shiftTask.findFirst({
            where: {
                sectionId: task.sectionId,
                sortOrder: direction === 'UP' ? { lt: task.sortOrder } : { gt: task.sortOrder }
            },
            orderBy: { sortOrder: direction === 'UP' ? 'desc' : 'asc' }
        });

        // No neighbour means it is already at that end of the section.
        // Note: the lt/gt comparison is strict, so two tasks sharing a
        // sortOrder cannot be reordered past each other. Seeded and
        // newly-created tasks always get distinct values, so this does not
        // arise in practice.
        if (!neighbour) return { success: true };

        await prisma.$transaction([
            prisma.shiftTask.update({ where: { id: task.id }, data: { sortOrder: neighbour.sortOrder } }),
            prisma.shiftTask.update({ where: { id: neighbour.id }, data: { sortOrder: task.sortOrder } })
        ]);

        revalidatePath('/[locale]/closing-lists');
        return { success: true };
    } catch (e) {
        console.error('Failed to reorder shift task:', e);
        return { success: false, error: 'No se pudo reordenar la tarea.' };
    }
}

export async function createShiftSection(
    listType: string,
    name: string,
    dayOfWeek?: number | null
): Promise<{ success: boolean; error?: string }> {
    const trimmed = name.trim();
    if (!trimmed) return { success: false, error: 'El nombre de la sección no puede estar vacío.' };

    try {
        const last = await prisma.shiftSection.findFirst({
            where: { listType },
            orderBy: { sortOrder: 'desc' },
            select: { sortOrder: true }
        });

        await prisma.shiftSection.create({
            data: {
                listType,
                name: trimmed,
                dayOfWeek: dayOfWeek ?? null,
                sortOrder: (last?.sortOrder ?? -1) + 1
            }
        });

        revalidatePath('/[locale]/closing-lists');
        return { success: true };
    } catch (e) {
        console.error('Failed to create shift section:', e);
        return { success: false, error: 'No se pudo crear la sección.' };
    }
}

export async function updateShiftSection(
    id: string,
    data: { name?: string; isActive?: boolean }
): Promise<{ success: boolean; error?: string }> {
    if (data.name !== undefined && !data.name.trim()) {
        return { success: false, error: 'El nombre de la sección no puede estar vacío.' };
    }

    try {
        await prisma.shiftSection.update({
            where: { id },
            data: {
                name: data.name !== undefined ? data.name.trim() : undefined,
                isActive: data.isActive !== undefined ? data.isActive : undefined
            }
        });

        revalidatePath('/[locale]/closing-lists');
        return { success: true };
    } catch (e) {
        console.error('Failed to update shift section:', e);
        return { success: false, error: 'No se pudo guardar la sección.' };
    }
}

/** Today's run, created on demand so the first tap starts the shift. */
async function ensureRun(listType: ShiftListType) {
    const businessDate = getBusinessDate();
    return prisma.shiftRun.upsert({
        where: { listType_businessDate: { listType, businessDate } },
        create: { listType, businessDate },
        update: {}
    });
}

export async function toggleShiftTask(
    listType: ShiftListType,
    taskId: string,
    checked: boolean
): Promise<{ success: boolean; error?: string }> {
    try {
        const run = await ensureRun(listType);

        if (checked) {
            // Upsert, not create: a double tap must not fail on the unique index.
            await prisma.shiftTaskCheck.upsert({
                where: { runId_taskId: { runId: run.id, taskId } },
                create: { runId: run.id, taskId },
                update: {}
            });
        } else {
            await prisma.shiftTaskCheck.deleteMany({ where: { runId: run.id, taskId } });
        }

        revalidatePath('/[locale]/closing-lists');
        return { success: true };
    } catch (e) {
        console.error('Failed to toggle shift task:', e);
        return { success: false, error: 'No se pudo guardar la tarea.' };
    }
}

export async function setShiftRunStaff(
    listType: ShiftListType,
    sectionId: string,
    employees: { id: string; name: string }[]
): Promise<{ success: boolean; error?: string }> {
    try {
        const run = await ensureRun(listType);

        // Replace wholesale in one transaction so the section is never briefly
        // left with nobody assigned.
        await prisma.$transaction([
            prisma.shiftRunStaff.deleteMany({ where: { runId: run.id, sectionId } }),
            prisma.shiftRunStaff.createMany({
                data: employees.map(e => ({
                    runId: run.id,
                    sectionId,
                    employeeId: e.id,
                    employeeName: e.name
                })),
                skipDuplicates: true
            })
        ]);

        revalidatePath('/[locale]/closing-lists');
        return { success: true };
    } catch (e) {
        console.error('Failed to set shift run staff:', e);
        return { success: false, error: 'No se pudo guardar el personal.' };
    }
}

export async function completeShiftRun(
    listType: ShiftListType
): Promise<{ success: boolean; error?: string }> {
    try {
        const run = await ensureRun(listType);
        await prisma.shiftRun.update({
            where: { id: run.id },
            data: { completedAt: new Date() }
        });

        revalidatePath('/[locale]/closing-lists');
        return { success: true };
    } catch (e) {
        console.error('Failed to complete shift run:', e);
        return { success: false, error: 'No se pudo cerrar la lista.' };
    }
}
