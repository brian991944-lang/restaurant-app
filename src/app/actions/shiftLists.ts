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
