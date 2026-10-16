'use server';

import prisma from '@/lib/prisma';
import { ImportKind } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { isAdminSession } from '@/lib/adminGuard';
import {
    parseTimesheetCsv,
    buildRosterIndex,
    type RosterEntry,
    type TimesheetParseResult,
} from '@/lib/timesheetParse';
import {
    detectTimesheetFormat,
    parseToastTimeCsv,
    type ToastRosterPerson,
} from '@/lib/toastTimeParse';

const PAYROLL_ROUTE = '/[locale]/payroll';
/** Every Toast batch id starts with this — CSV uploads and the hand-loaded API weeks alike. */
const TOAST_BATCH_PREFIX = 'TOAST';
/** The Reports page reads the same imports, so it is revalidated alongside. */
const REPORTS_ROUTE = '/[locale]/reports';

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

/** A previewed punch as the row createMany writes. */
function punchRow(p: PunchToCommit, importBatchId: string) {
    return {
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
    };
}

/** Someone a Toast name can be mapped to from the import preview. */
export type EmployeeOption = { id: string; name: string };

/**
 * Everyone the app knows, read from the DATABASE rather than Clover, which is
 * being disconnected: every EmployeeRate row, plus each name/ID pair earlier
 * punches were stored under. A person's displayName is the name their most
 * recent punch uses, so a new import files hours where the old ones are.
 */
async function loadDbRoster(): Promise<{ roster: ToastRosterPerson[]; rateIds: Set<string> }> {
    const [rates, pairs] = await Promise.all([
        prisma.employeeRate.findMany({
            select: { cloverEmployeeId: true, employeeName: true, toastName: true },
        }),
        prisma.payrollPunch.groupBy({
            by: ['cloverEmployeeId', 'employeeName'],
            where: { cloverEmployeeId: { not: null } },
            _max: { clockIn: true },
        }),
    ]);

    const people = new Map<string, ToastRosterPerson & { latest: number }>();
    for (const r of rates) {
        people.set(r.cloverEmployeeId, {
            id: r.cloverEmployeeId,
            displayName: r.employeeName,
            names: [r.employeeName],
            toastName: r.toastName,
            latest: -Infinity,
        });
    }
    for (const pair of pairs) {
        const id = pair.cloverEmployeeId!;
        const at = pair._max.clockIn?.getTime() ?? -Infinity;
        const person = people.get(id)
            ?? { id, displayName: pair.employeeName, names: [], toastName: null, latest: -Infinity };
        if (!person.names.includes(pair.employeeName)) person.names.push(pair.employeeName);
        if (at > person.latest) {
            person.latest = at;
            person.displayName = pair.employeeName;
        }
        people.set(id, person);
    }
    return {
        roster: [...people.values()].map(({ latest: _latest, ...p }) => p),
        rateIds: new Set(rates.map(r => r.cloverEmployeeId)),
    };
}

/**
 * Parse and validate a timesheet export — Homebase or Toast, told apart by the
 * file's contents. WRITES NOTHING.
 *
 * The roster is read from the database here and handed to the parser, which
 * stays pure — that split is what lets the same parsing run against a fixture
 * offline.
 *
 * A roster that cannot be read is not fatal: every name simply resolves to
 * null, each such punch is flagged, and the preview says so. Refusing to parse
 * would leave the user with nothing to look at over a problem they can see and
 * decide about.
 */
export async function parseTimesheet(csvText: string, fileName?: string | null): Promise<{
    success: boolean;
    error?: string;
    result?: TimesheetParseResult;
    rosterError?: string;
    /** Toast only: who an unmatched name can be mapped to. */
    employeeOptions?: EmployeeOption[];
}> {
    if (!csvText || !csvText.trim()) {
        return { success: false, error: 'El archivo está vacío.' };
    }

    const format = detectTimesheetFormat(csvText);
    if (!format) {
        return { success: false, error: 'No se reconoce el archivo. Sube una exportación de horas de Homebase o de Toast.' };
    }

    let roster: ToastRosterPerson[] = [];
    let rateIds = new Set<string>();
    let rosterError: string | undefined;
    try {
        ({ roster, rateIds } = await loadDbRoster());
    } catch (e) {
        rosterError = `No se pudo leer el personal desde la base de datos, así que ningún nombre pudo vincularse: ${e instanceof Error ? e.message : String(e)}`;
    }

    try {
        if (format === 'TOAST') {
            const result = parseToastTimeCsv(csvText, roster, fileName);
            if (result.punches.length === 0) {
                return {
                    success: false,
                    error: result.parseErrors[0] ?? 'No se encontró ningún registro de horas en el archivo de Toast.',
                    rosterError,
                };
            }
            // Only people with an EmployeeRate row can hold a saved mapping.
            const employeeOptions = roster
                .filter(p => rateIds.has(p.id) && p.id !== 'DFLTEMPLOYEE')
                .map(p => ({ id: p.id, name: p.displayName }))
                .sort((a, b) => a.name.localeCompare(b.name, 'es'));
            return { success: true, result, rosterError, employeeOptions };
        }

        const homebaseRoster: RosterEntry[] = roster.flatMap(p => p.names.map(name => ({ id: p.id, name })));
        const result = parseTimesheetCsv(csvText, buildRosterIndex(homebaseRoster));

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
 * because the export was wrong, and an import must not undo that. Nor are
 * Toast imports (importBatchId "TOAST…"): a Homebase file is only ever the
 * authority on Homebase's rows.
 */
export async function commitTimesheet(
    punches: PunchToCommit[],
    importBatchId: string,
    periodStart?: Date | null,
    periodEnd?: Date | null,
    /** The uploaded file's name, recorded in the ImportLog. Optional so an older
     *  caller still works; the log simply has no name for that upload. */
    fileName?: string | null
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
                    // Spelled out with the null case because NOT LIKE is NULL —
                    // not true — for a row with no batch id.
                    OR: [
                        { importBatchId: null },
                        { NOT: { importBatchId: { startsWith: TOAST_BATCH_PREFIX } } },
                    ],
                },
            });

            const inserted = await tx.payrollPunch.createMany({
                data: punches.map(p => punchRow(p, importBatchId)),
            });

            // Logged INSIDE the transaction so the history cannot disagree with
            // the data: an insert that rolls back must not leave a row claiming
            // it happened.
            //
            // The period recorded is the range actually deleted and reinserted,
            // not the period the file states. Those differ when a shift clocks
            // in after midnight on the first day, and the log should say which
            // days this upload really touched.
            await tx.importLog.create({
                data: {
                    kind: ImportKind.TIMESHEET,
                    fileName: fileName?.trim() ? fileName.trim() : null,
                    periodStart: rangeStart,
                    periodEnd: rangeEnd,
                    rowsImported: inserted.count,
                },
            });

            return { replaced: removed.count, created: inserted.count };
        });

        revalidatePath(PAYROLL_ROUTE, 'page');
        revalidatePath(REPORTS_ROUTE, 'page');

        return { success: true, created: result.created, replaced: result.replaced };
    } catch (e) {
        return {
            success: false,
            error: `No se pudieron guardar las horas: ${e instanceof Error ? e.message : String(e)}`,
        };
    }
}

/**
 * Write a previewed Toast time-entry export — only the rows left checked.
 *
 * Replaces ONLY earlier Toast rows (importBatchId "TOAST…", which includes the
 * hand-loaded TOAST_API weeks) on the business dates the file covers. Homebase
 * imports and other manual punches on those dates are kept: a week can mix
 * both, and the Toast file says nothing about Homebase's rows.
 */
export async function commitToastTimesheet(
    punches: PunchToCommit[],
    fileName: string,
    periodStart?: Date | null,
    periodEnd?: Date | null
): Promise<{ success: boolean; error?: string; created?: number; replaced?: number }> {
    if (!(await isAdminSession())) {
        return { success: false, error: 'No tienes permiso para importar horas.' };
    }
    if (!punches?.length) {
        return { success: false, error: 'No hay registros para importar.' };
    }
    const name = fileName?.trim() || 'toast.csv';
    const importBatchId = `${TOAST_BATCH_PREFIX}_CSV_${name}-${Date.now()}`;

    try {
        // Same window rule as commitTimesheet: the stated period unioned with
        // the dates the punches actually land on.
        const punchTimes = punches.map(p => new Date(p.businessDate).getTime());
        const rangeStart = new Date(Math.min(...punchTimes, ...(periodStart ? [new Date(periodStart).getTime()] : [])));
        const rangeEnd = new Date(Math.max(...punchTimes, ...(periodEnd ? [new Date(periodEnd).getTime()] : [])));

        const result = await prisma.$transaction(async (tx) => {
            const removed = await tx.payrollPunch.deleteMany({
                where: {
                    businessDate: { gte: rangeStart, lte: rangeEnd },
                    importBatchId: { startsWith: TOAST_BATCH_PREFIX },
                },
            });
            const inserted = await tx.payrollPunch.createMany({
                data: punches.map(p => punchRow(p, importBatchId)),
            });
            // Inside the transaction, as in commitTimesheet, so the history
            // cannot claim an import that rolled back.
            await tx.importLog.create({
                data: {
                    kind: ImportKind.TIMESHEET,
                    fileName: name,
                    periodStart: rangeStart,
                    periodEnd: rangeEnd,
                    rowsImported: inserted.count,
                },
            });
            return { replaced: removed.count, created: inserted.count };
        });

        revalidatePath(PAYROLL_ROUTE, 'page');
        revalidatePath(REPORTS_ROUTE, 'page');

        return { success: true, created: result.created, replaced: result.replaced };
    } catch (e) {
        return {
            success: false,
            error: `No se pudieron guardar las horas: ${e instanceof Error ? e.message : String(e)}`,
        };
    }
}

/**
 * Remember that a Toast name is this person, so the next upload matches it
 * without asking. A name belongs to one person at a time: saving it here
 * clears it from anyone else who held it.
 */
export async function saveToastNameMapping(
    toastName: string,
    cloverEmployeeId: string
): Promise<{ success: boolean; error?: string }> {
    if (!(await isAdminSession())) {
        return { success: false, error: 'No tienes permiso para cambiar el personal.' };
    }
    const name = toastName?.trim().replace(/\s+/g, ' ');
    if (!name || !cloverEmployeeId) {
        return { success: false, error: 'Falta el nombre o el empleado.' };
    }
    try {
        await prisma.$transaction([
            prisma.employeeRate.updateMany({
                where: { toastName: { equals: name, mode: 'insensitive' }, NOT: { cloverEmployeeId } },
                data: { toastName: null },
            }),
            prisma.employeeRate.update({
                where: { cloverEmployeeId },
                data: { toastName: name },
            }),
        ]);
        return { success: true };
    } catch (e) {
        return {
            success: false,
            error: `No se pudo guardar el nombre de Toast: ${e instanceof Error ? e.message : String(e)}`,
        };
    }
}
