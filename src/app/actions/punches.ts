'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { cloverFetch } from '@/lib/clover';
import { isAdminSession } from '@/lib/adminGuard';
import {
    parseTimesheetCsv,
    buildRosterIndex,
    type RosterEntry,
    type TimesheetParseResult,
} from '@/lib/timesheetParse';

const PAYROLL_ROUTE = '/[locale]/payroll';

/**
 * What commitTimesheet needs from the preview. Deliberately narrower than
 * ParsedPunch: csvLine and the flag list are review aids, not columns, and
 * nothing that crosses back from the client is trusted to be more than this.
 */
export type PunchToCommit = {
    businessDate: Date;
    employeeName: string;
    cloverEmployeeId: string | null;
    clockIn: Date;
    clockOut: Date | null;
    hours: number;
    isFlagged: boolean;
    flagReason: string | null;
};

/**
 * Parse and validate a Homebase timesheet export. WRITES NOTHING.
 *
 * The Clover roster is fetched here and handed to the parser, which stays pure
 * — that split is what lets the same parsing run against a fixture offline.
 *
 * A roster that cannot be reached is not fatal: every name simply resolves to
 * null, each such punch is flagged, and the preview says so. Refusing to parse
 * would leave the user with nothing to look at over a problem they can see and
 * decide about.
 */
export async function parseTimesheet(csvText: string): Promise<{
    success: boolean;
    error?: string;
    result?: TimesheetParseResult;
    rosterError?: string;
}> {
    if (!csvText || !csvText.trim()) {
        return { success: false, error: 'El archivo está vacío.' };
    }

    let roster: RosterEntry[] = [];
    let rosterError: string | undefined;
    try {
        const data = await cloverFetch('/employees?limit=100');
        roster = (data?.elements ?? []) as RosterEntry[];
    } catch (e) {
        rosterError = `No se pudo leer el personal desde Clover, así que ningún nombre pudo vincularse: ${e instanceof Error ? e.message : String(e)}`;
    }

    try {
        const result = parseTimesheetCsv(csvText, buildRosterIndex(roster));

        if (result.punches.length === 0) {
            return {
                success: false,
                error: 'No se encontró ningún registro de horas en el archivo. ¿Es una exportación de Homebase?',
                rosterError,
            };
        }

        return { success: true, result, rosterError };
    } catch (e) {
        return {
            success: false,
            error: `No se pudo leer el archivo: ${e instanceof Error ? e.message : String(e)}`,
            rosterError,
        };
    }
}

/**
 * Write the previewed punches.
 *
 * Re-importing a corrected export REPLACES the period rather than duplicating
 * it: every IMPORTADO punch whose businessDate falls in the covered range is
 * deleted first, then the new batch is inserted, both inside one transaction.
 * Fixing one row in Homebase and re-uploading therefore converges on the
 * corrected file instead of doubling everyone's hours.
 *
 * MANUAL punches are never touched. Someone typed those in by hand precisely
 * because the export was wrong, and an import must not undo that.
 */
export async function commitTimesheet(
    punches: PunchToCommit[],
    importBatchId: string,
    periodStart?: Date | null,
    periodEnd?: Date | null
): Promise<{ success: boolean; error?: string; created?: number; replaced?: number }> {
    if (!(await isAdminSession())) {
        return { success: false, error: 'No tienes permiso para importar horas.' };
    }

    if (!punches?.length) {
        return { success: false, error: 'No hay registros para importar.' };
    }
    if (!importBatchId?.trim()) {
        return { success: false, error: 'Falta el identificador del lote de importación.' };
    }

    try {
        // The delete window is the stated payroll period UNIONED with the range
        // the punches actually cover. They can differ: a shift clocking in after
        // midnight on the first day of the period lands on the business date
        // BEFORE it, and a punch outside the deleted window would survive the
        // re-import and double-count.
        const punchTimes = punches.map(p => new Date(p.businessDate).getTime());
        const candidatesStart = [...punchTimes, ...(periodStart ? [new Date(periodStart).getTime()] : [])];
        const candidatesEnd = [...punchTimes, ...(periodEnd ? [new Date(periodEnd).getTime()] : [])];
        const rangeStart = new Date(Math.min(...candidatesStart));
        const rangeEnd = new Date(Math.max(...candidatesEnd));

        const result = await prisma.$transaction(async (tx) => {
            const removed = await tx.payrollPunch.deleteMany({
                where: {
                    businessDate: { gte: rangeStart, lte: rangeEnd },
                    source: 'IMPORTADO',
                },
            });

            const inserted = await tx.payrollPunch.createMany({
                data: punches.map(p => ({
                    businessDate: new Date(p.businessDate),
                    employeeName: p.employeeName,
                    cloverEmployeeId: p.cloverEmployeeId,
                    clockIn: new Date(p.clockIn),
                    clockOut: p.clockOut ? new Date(p.clockOut) : null,
                    // Fixed to 2dp on the way into Decimal(7,2) so the stored
                    // value is exactly what the export reported.
                    hours: p.hours.toFixed(2),
                    source: 'IMPORTADO' as const,
                    isFlagged: p.isFlagged,
                    flagReason: p.flagReason,
                    importBatchId,
                })),
            });

            return { replaced: removed.count, created: inserted.count };
        });

        revalidatePath(PAYROLL_ROUTE);

        return { success: true, created: result.created, replaced: result.replaced };
    } catch (e) {
        return {
            success: false,
            error: `No se pudieron guardar las horas: ${e instanceof Error ? e.message : String(e)}`,
        };
    }
}
