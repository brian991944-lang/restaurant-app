'use server';

import prisma from '@/lib/prisma';
import { Prisma, TipDayStatus, TipEntryRole, TipTargetField } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { getBusinessDateAsDate } from '@/lib/businessDay';
import { toCents, sumCents } from '@/lib/money';
import { isAdminSession } from '@/lib/adminGuard';

const TIPS_ROUTE = '/[locale]/tips-reviews';

/**
 * Decimal → number conversion for this module.
 *
 * Prisma Decimal is not serializable across the server/client boundary, so
 * every Decimal is converted explicitly here rather than leaking through.
 * `decOrNull` preserves null: for cashTips, null ("not counted yet") and 0
 * ("counted, was zero") are different states and must not collapse.
 */
const dec = (d: Prisma.Decimal): number => d.toNumber();
const decOrNull = (d: Prisma.Decimal | null): number | null => (d === null ? null : d.toNumber());

export type TipEntryChange = {
    entryId: string;
    creditTips?: number;
    serviceCharge?: number;
    cashTips?: number | null;
};

export type TipDayChanges = {
    entries?: TipEntryChange[];
    totalCreditTips?: number;
    totalServiceCharge?: number;
    totalCashTips?: number;
};

/** Thrown inside a transaction to roll it back with a user-facing message. */
class TipValidationError extends Error {}

/** Human label for a shift — shifts have an order, not a name. */
const shiftLabel = (orderIndex: number) => `Turno ${orderIndex + 1}`;

/**
 * Cent-exact reconciliation. Runs against the transaction client so the check
 * sees the same uncommitted state the caller just wrote.
 *
 * Returns a Spanish message describing the first problem, or null if the day
 * balances. All comparison is on integer cents — never on Decimal or float.
 */
async function findReconciliationError(
    tx: Prisma.TransactionClient,
    tipDayId: string
): Promise<string | null> {
    const day = await tx.tipDay.findUnique({
        where: { id: tipDayId },
        include: { shifts: { orderBy: { orderIndex: 'asc' }, include: { entries: true } } }
    });
    if (!day) return 'No se encontró el día de propinas.';

    const entries = day.shifts.flatMap(s => s.entries.map(e => ({ entry: e, shift: s })));
    if (entries.length === 0) {
        return 'No hay ninguna persona registrada en el día.';
    }

    // An uncounted row still blocks submission. This is not a reconciliation —
    // there is nothing to reconcile cash against — it is the requirement that
    // somebody actually answered the question for every person.
    const missing = entries.find(({ entry }) => entry.cashTips === null);
    if (missing) {
        return `Falta confirmar la propina en efectivo de ${missing.entry.employeeName} en ${shiftLabel(missing.shift.orderIndex)}.`;
    }

    // Only the two card figures are reconciled. Both come from Clover, which
    // settled them, so a mismatch means the distribution is wrong rather than
    // that the target might be. Cash has no such counterpart — it never passes
    // through the POS — so summing it against totalCashTips would only be
    // checking the staff's arithmetic against their own number.
    const checks: { label: string; sum: number; target: number }[] = [
        {
            label: 'las propinas con tarjeta',
            sum: sumCents(entries.map(({ entry }) => toCents(dec(entry.creditTips)))),
            target: toCents(dec(day.totalCreditTips))
        },
        {
            label: 'el cargo por servicio',
            sum: sumCents(entries.map(({ entry }) => toCents(dec(entry.serviceCharge)))),
            target: toCents(dec(day.totalServiceCharge))
        }
    ];

    for (const c of checks) {
        if (c.sum !== c.target) {
            const diff = (c.sum - c.target) / 100;
            return `La suma de ${c.label} no cuadra con el total del día: repartido ${(c.sum / 100).toFixed(2)}, total ${(c.target / 100).toFixed(2)} (diferencia ${diff.toFixed(2)}).`;
        }
    }

    return null;
}

/** Shape returned to the client — every Decimal already a number. */
function serializeDay(day: Prisma.TipDayGetPayload<{
    include: {
        shifts: { include: { entries: true } };
        employeeTips: true;
    };
}>) {
    return {
        id: day.id,
        businessDate: day.businessDate,
        cloverCreditTips: decOrNull(day.cloverCreditTips),
        cloverServiceCharge: decOrNull(day.cloverServiceCharge),
        cloverSyncedAt: day.cloverSyncedAt,
        cloverOrdersScanned: day.cloverOrdersScanned,
        cloverPaymentsScanned: day.cloverPaymentsScanned,
        cloverSyncDurationMs: day.cloverSyncDurationMs,
        // What Clover reported per person on the last sync. A cache to compare
        // against — never what anyone is owed. See TipDayEmployeeTip.
        employeeTips: day.employeeTips.map(tip => ({
            id: tip.id,
            cloverEmployeeId: tip.cloverEmployeeId,
            employeeName: tip.employeeName,
            paymentCount: tip.paymentCount,
            cardTips: dec(tip.cardTips),
            serviceCharge: dec(tip.serviceCharge),
            salesAmount: dec(tip.salesAmount),
            syncedAt: tip.syncedAt
        })),
        totalCreditTips: dec(day.totalCreditTips),
        totalServiceCharge: dec(day.totalServiceCharge),
        totalCashTips: dec(day.totalCashTips),
        status: day.status,
        submittedAt: day.submittedAt,
        submittedByCloverId: day.submittedByCloverId,
        submittedByName: day.submittedByName,
        shifts: day.shifts.map(shift => ({
            id: shift.id,
            orderIndex: shift.orderIndex,
            filledByCloverId: shift.filledByCloverId,
            filledByName: shift.filledByName,
            filledAt: shift.filledAt,
            entries: shift.entries.map(entry => ({
                id: entry.id,
                cloverEmployeeId: entry.cloverEmployeeId,
                employeeName: entry.employeeName,
                userId: entry.userId,
                role: entry.role,
                creditTips: dec(entry.creditTips),
                serviceCharge: dec(entry.serviceCharge),
                cashTips: decOrNull(entry.cashTips),
                cashZeroConfirmedByCloverId: entry.cashZeroConfirmedByCloverId,
                cashZeroConfirmedByName: entry.cashZeroConfirmedByName,
                cashZeroConfirmedAt: entry.cashZeroConfirmedAt
            }))
        }))
    };
}

const DAY_INCLUDE = {
    shifts: {
        orderBy: { orderIndex: 'asc' },
        include: { entries: { orderBy: { createdAt: 'asc' } } }
    },
    // Biggest earner first: the breakdown is read top-down as a sanity check.
    employeeTips: { orderBy: { cardTips: 'desc' } }
} satisfies Prisma.TipDayInclude;

/**
 * The tip day for a business date, or null if none has been started.
 *
 * Reader: pure. Merely viewing the page must never create a row, so callers
 * that need a day to exist use ensureTipDay instead.
 */
export async function getTipDay(businessDate?: Date) {
    const date = businessDate ?? getBusinessDateAsDate();

    const day = await prisma.tipDay.findUnique({
        where: { businessDate: date },
        include: DAY_INCLUDE
    });

    return day ? serializeDay(day) : null;
}

/**
 * The tip day for a business date, created if absent along with its first
 * shift. Called when a user actually starts entering data.
 *
 * The upsert means two tablets doing this at once cannot collide on the
 * unique businessDate.
 */
export async function ensureTipDay(businessDate?: Date) {
    const date = businessDate ?? getBusinessDateAsDate();

    try {
        await prisma.tipDay.upsert({
            where: { businessDate: date },
            create: {
                businessDate: date,
                // A day always has at least one shift, so the UI never opens empty.
                shifts: { create: { orderIndex: 0 } }
            },
            update: {}
        });

        const day = await prisma.tipDay.findUniqueOrThrow({
            where: { businessDate: date },
            include: DAY_INCLUDE
        });

        // Deliberately does NOT revalidate, unlike every other writer here.
        //
        // Its only caller is the tips page, which calls it DURING RENDER to open
        // today. Revalidating from there is the route invalidating itself while
        // it is still rendering — circular, and unsupported by Next.js, which
        // rejected it outright:
        //
        //   Route /[locale]/tips-reviews used "revalidatePath /[locale]/tips-reviews"
        //   during render which is unsupported.
        //
        // It also bought nothing even in principle: the caller receives the
        // fresh day below and renders it directly, so there is no stale cache
        // left to clear. If this ever gains an INTERACTIVE caller, that caller
        // revalidates — not this function.
        return { success: true as const, day: serializeDay(day) };
    } catch (e) {
        console.error('Failed to ensure tip day:', e);
        return { success: false as const, error: 'No se pudo abrir el día de propinas.' };
    }
}

/** Guard shared by every writer: a submitted day is closed to normal edits. */
async function assertEditable(tipDayId: string): Promise<string | null> {
    const day = await prisma.tipDay.findUnique({
        where: { id: tipDayId },
        select: { status: true }
    });
    if (!day) return 'No se encontró el día de propinas.';
    if (day.status === TipDayStatus.ENVIADO) {
        return 'Este día ya fue enviado. Pide a un administrador que lo reabra.';
    }
    return null;
}

export async function addShift(tipDayId: string): Promise<{ success: boolean; error?: string }> {
    const blocked = await assertEditable(tipDayId);
    if (blocked) return { success: false, error: blocked };

    try {
        const last = await prisma.tipShift.findFirst({
            where: { tipDayId },
            orderBy: { orderIndex: 'desc' },
            select: { orderIndex: true }
        });

        await prisma.tipShift.create({
            data: { tipDayId, orderIndex: (last?.orderIndex ?? -1) + 1 }
        });

        revalidatePath(TIPS_ROUTE);
        return { success: true };
    } catch (e) {
        console.error('Failed to add tip shift:', e);
        return { success: false, error: 'No se pudo añadir el turno.' };
    }
}

export async function removeShift(shiftId: string): Promise<{ success: boolean; error?: string }> {
    const shift = await prisma.tipShift.findUnique({
        where: { id: shiftId },
        select: { tipDayId: true }
    });
    if (!shift) return { success: false, error: 'No se encontró el turno.' };

    const blocked = await assertEditable(shift.tipDayId);
    if (blocked) return { success: false, error: blocked };

    const count = await prisma.tipShift.count({ where: { tipDayId: shift.tipDayId } });
    if (count <= 1) {
        return { success: false, error: 'El día debe tener al menos un turno.' };
    }

    try {
        await prisma.$transaction(async tx => {
            await tx.tipShift.delete({ where: { id: shiftId } });

            // Renumber so orderIndex stays contiguous from 0 — the @@unique on
            // [tipDayId, orderIndex] means a later insert would otherwise be
            // able to collide with a stale index.
            const remaining = await tx.tipShift.findMany({
                where: { tipDayId: shift.tipDayId },
                orderBy: { orderIndex: 'asc' },
                select: { id: true }
            });
            for (let i = 0; i < remaining.length; i++) {
                await tx.tipShift.update({
                    where: { id: remaining[i].id },
                    data: { orderIndex: i }
                });
            }
        });

        revalidatePath(TIPS_ROUTE);
        return { success: true };
    } catch (e) {
        console.error('Failed to remove tip shift:', e);
        return { success: false, error: 'No se pudo borrar el turno.' };
    }
}

export async function upsertEntry(
    shiftId: string,
    cloverEmployeeId: string,
    employeeName: string,
    role: TipEntryRole,
    creditTips: number,
    serviceCharge: number,
    cashTips: number | null
): Promise<{ success: boolean; error?: string }> {
    if (!cloverEmployeeId) return { success: false, error: 'Falta identificar a la persona.' };

    const shift = await prisma.tipShift.findUnique({
        where: { id: shiftId },
        select: { tipDayId: true }
    });
    if (!shift) return { success: false, error: 'No se encontró el turno.' };

    const blocked = await assertEditable(shift.tipDayId);
    if (blocked) return { success: false, error: blocked };

    try {
        // A non-zero cash amount invalidates any prior "confirmed zero", so the
        // confirmation is cleared rather than left asserting something untrue.
        const clearsZeroConfirmation = cashTips !== null && cashTips !== 0;
        const zeroConfirmationReset = clearsZeroConfirmation
            ? {
                cashZeroConfirmedByCloverId: null,
                cashZeroConfirmedByName: null,
                cashZeroConfirmedAt: null
            }
            : {};

        await prisma.tipShiftEntry.upsert({
            where: { tipShiftId_cloverEmployeeId: { tipShiftId: shiftId, cloverEmployeeId } },
            create: {
                tipShiftId: shiftId,
                cloverEmployeeId,
                employeeName,
                role,
                creditTips,
                serviceCharge,
                cashTips
            },
            update: {
                employeeName,
                role,
                creditTips,
                serviceCharge,
                cashTips,
                ...zeroConfirmationReset
            }
        });

        revalidatePath(TIPS_ROUTE);
        return { success: true };
    } catch (e) {
        console.error('Failed to upsert tip entry:', e);
        return { success: false, error: 'No se pudo guardar la persona.' };
    }
}

export type ShiftEntryInput = {
    cloverEmployeeId: string;
    employeeName: string;
    role: TipEntryRole;
    creditTips: number;
    serviceCharge: number;
    cashTips: number | null;
};

/**
 * Replace a shift's roster in one atomic write.
 *
 * The submitted array is authoritative: rows in it are upserted, and anyone in
 * the shift who is absent from it is removed. Everything is validated before
 * the transaction opens, so a bad row rejects the whole call rather than
 * leaving the shift half-saved.
 */
export async function saveShift(
    shiftId: string,
    entries: ShiftEntryInput[],
    filledByCloverId: string,
    filledByName: string
): Promise<{ success: boolean; error?: string }> {
    if (!filledByCloverId) {
        return { success: false, error: 'Falta indicar quién llenó este turno.' };
    }

    // Position is 1-based because the message is read by someone looking at a
    // numbered list of rows, not at an array.
    for (let i = 0; i < entries.length; i++) {
        if (!entries[i].cloverEmployeeId) {
            return { success: false, error: `Falta elegir la persona de la fila ${i + 1}.` };
        }
    }

    const seen = new Set<string>();
    for (const e of entries) {
        if (seen.has(e.cloverEmployeeId)) {
            return {
                success: false,
                error: `${e.employeeName || 'Esa persona'} está repetida en el turno. Cada persona puede aparecer una sola vez.`
            };
        }
        seen.add(e.cloverEmployeeId);
    }

    const shift = await prisma.tipShift.findUnique({
        where: { id: shiftId },
        select: { tipDayId: true }
    });
    if (!shift) return { success: false, error: 'No se encontró el turno.' };

    const blocked = await assertEditable(shift.tipDayId);
    if (blocked) return { success: false, error: blocked };

    try {
        await prisma.$transaction(async tx => {
            for (const e of entries) {
                // Changing someone's cash away from zero invalidates a prior
                // "confirmed zero", so the confirmation is cleared with it.
                const clearsZeroConfirmation = e.cashTips !== null && e.cashTips !== 0;

                await tx.tipShiftEntry.upsert({
                    where: {
                        tipShiftId_cloverEmployeeId: {
                            tipShiftId: shiftId,
                            cloverEmployeeId: e.cloverEmployeeId
                        }
                    },
                    create: {
                        tipShiftId: shiftId,
                        cloverEmployeeId: e.cloverEmployeeId,
                        employeeName: e.employeeName,
                        role: e.role,
                        creditTips: e.creditTips,
                        serviceCharge: e.serviceCharge,
                        cashTips: e.cashTips
                    },
                    update: {
                        employeeName: e.employeeName,
                        role: e.role,
                        creditTips: e.creditTips,
                        serviceCharge: e.serviceCharge,
                        cashTips: e.cashTips,
                        ...(clearsZeroConfirmation
                            ? {
                                cashZeroConfirmedByCloverId: null,
                                cashZeroConfirmedByName: null,
                                cashZeroConfirmedAt: null
                            }
                            : {})
                    }
                });
            }

            // Anyone dropped from the array is dropped from the shift. With an
            // empty array this clears the shift entirely, which is the correct
            // reading of "these are all the people".
            await tx.tipShiftEntry.deleteMany({
                where: {
                    tipShiftId: shiftId,
                    cloverEmployeeId: { notIn: entries.map(e => e.cloverEmployeeId) }
                }
            });

            await tx.tipShift.update({
                where: { id: shiftId },
                data: {
                    filledByCloverId,
                    filledByName,
                    filledAt: new Date()
                }
            });
        });

        revalidatePath(TIPS_ROUTE);
        return { success: true };
    } catch (e) {
        console.error('Failed to save shift:', e);
        return { success: false, error: 'No se pudo guardar el turno.' };
    }
}

export async function removeEntry(entryId: string): Promise<{ success: boolean; error?: string }> {
    const entry = await prisma.tipShiftEntry.findUnique({
        where: { id: entryId },
        select: { tipShift: { select: { tipDayId: true } } }
    });
    if (!entry) return { success: false, error: 'No se encontró la persona.' };

    const blocked = await assertEditable(entry.tipShift.tipDayId);
    if (blocked) return { success: false, error: blocked };

    try {
        await prisma.tipShiftEntry.delete({ where: { id: entryId } });
        revalidatePath(TIPS_ROUTE);
        return { success: true };
    } catch (e) {
        console.error('Failed to remove tip entry:', e);
        return { success: false, error: 'No se pudo borrar la persona.' };
    }
}

export async function confirmZeroCash(
    entryId: string,
    confirmedByCloverId: string,
    confirmedByName: string
): Promise<{ success: boolean; error?: string }> {
    if (!confirmedByCloverId) return { success: false, error: 'Falta identificar quién confirma.' };

    const entry = await prisma.tipShiftEntry.findUnique({
        where: { id: entryId },
        select: { tipShift: { select: { tipDayId: true } } }
    });
    if (!entry) return { success: false, error: 'No se encontró la persona.' };

    const blocked = await assertEditable(entry.tipShift.tipDayId);
    if (blocked) return { success: false, error: blocked };

    try {
        await prisma.tipShiftEntry.update({
            where: { id: entryId },
            data: {
                cashTips: 0,
                cashZeroConfirmedByCloverId: confirmedByCloverId,
                cashZeroConfirmedByName: confirmedByName,
                cashZeroConfirmedAt: new Date()
            }
        });

        revalidatePath(TIPS_ROUTE);
        return { success: true };
    } catch (e) {
        console.error('Failed to confirm zero cash:', e);
        return { success: false, error: 'No se pudo confirmar el efectivo en cero.' };
    }
}

/** Which TipDay total each overridable field maps to. */
const TOTAL_FIELD: Partial<Record<TipTargetField, 'totalCreditTips' | 'totalServiceCharge' | 'totalCashTips'>> = {
    [TipTargetField.CREDIT_TIPS]: 'totalCreditTips',
    [TipTargetField.SERVICE_CHARGE]: 'totalServiceCharge',
    [TipTargetField.CASH_TIPS]: 'totalCashTips'
};

export async function setTipTargets(
    tipDayId: string,
    field: TipTargetField,
    newValue: number,
    changedByCloverId: string,
    changedByName: string,
    reason?: string
): Promise<{ success: boolean; error?: string }> {
    const column = TOTAL_FIELD[field];
    if (!column) return { success: false, error: 'Ese campo no es un total editable.' };
    if (!Number.isFinite(newValue) || newValue < 0) {
        return { success: false, error: 'El monto no es válido.' };
    }
    if (!changedByCloverId) return { success: false, error: 'Falta identificar quién hace el cambio.' };

    const blocked = await assertEditable(tipDayId);
    if (blocked) return { success: false, error: blocked };

    try {
        await prisma.$transaction(async tx => {
            const day = await tx.tipDay.findUniqueOrThrow({
                where: { id: tipDayId },
                select: { totalCreditTips: true, totalServiceCharge: true, totalCashTips: true }
            });

            // Log before applying, so the previous value is always recoverable.
            await tx.tipTargetOverride.create({
                data: {
                    tipDayId,
                    field,
                    previousValue: day[column],
                    newValue,
                    reason: reason ?? null,
                    changedByCloverId,
                    changedByName
                }
            });

            await tx.tipDay.update({ where: { id: tipDayId }, data: { [column]: newValue } });
        });

        revalidatePath(TIPS_ROUTE);
        return { success: true };
    } catch (e) {
        console.error('Failed to set tip target:', e);
        return { success: false, error: 'No se pudo guardar el total.' };
    }
}

export async function submitTipDay(
    tipDayId: string,
    submittedByCloverId: string,
    submittedByName: string
): Promise<{ success: boolean; error?: string }> {
    if (!submittedByCloverId) return { success: false, error: 'Falta identificar quién envía.' };

    const blocked = await assertEditable(tipDayId);
    if (blocked) return { success: false, error: blocked };

    try {
        await prisma.$transaction(async tx => {
            // Re-checked here against stored rows — the client's arithmetic is
            // never trusted.
            const problem = await findReconciliationError(tx, tipDayId);
            if (problem) throw new TipValidationError(problem);

            await tx.tipDay.update({
                where: { id: tipDayId },
                data: {
                    status: TipDayStatus.ENVIADO,
                    submittedAt: new Date(),
                    submittedByCloverId,
                    submittedByName
                }
            });
        });

        revalidatePath(TIPS_ROUTE);
        return { success: true };
    } catch (e) {
        if (e instanceof TipValidationError) return { success: false, error: e.message };
        console.error('Failed to submit tip day:', e);
        return { success: false, error: 'No se pudo enviar el día.' };
    }
}

/**
 * Edit a day that has already been submitted.
 *
 * Every changed value is written to TipTargetOverride BEFORE it is applied.
 * The cookie check is a speed bump; this audit trail is the actual
 * accountability mechanism, so an edit must never apply without it.
 */
export async function adminUpdateSubmittedDay(
    tipDayId: string,
    changes: TipDayChanges,
    changedByCloverId: string,
    changedByName: string,
    reason?: string
): Promise<{ success: boolean; error?: string }> {
    if (!(await isAdminSession())) {
        return { success: false, error: 'No tienes permiso para editar un día ya enviado.' };
    }
    if (!changedByCloverId) return { success: false, error: 'Falta identificar quién hace el cambio.' };

    const hasChanges =
        (changes.entries?.length ?? 0) > 0 ||
        changes.totalCreditTips !== undefined ||
        changes.totalServiceCharge !== undefined ||
        changes.totalCashTips !== undefined;
    if (!hasChanges) return { success: false, error: 'No hay cambios que guardar.' };

    try {
        await prisma.$transaction(async tx => {
            const day = await tx.tipDay.findUnique({
                where: { id: tipDayId },
                include: { shifts: { include: { entries: true } } }
            });
            if (!day) throw new TipValidationError('No se encontró el día de propinas.');

            // entryId is set for entry-level changes and left null for the
            // day totals. The note is kept either way: it snapshots the label
            // and field as they read at the time, which the join cannot
            // reconstruct after a rename or a shift renumber.
            const logChange = (
                previousValue: Prisma.Decimal | number,
                newValue: number,
                note: string,
                entryId: string | null = null
            ) =>
                tx.tipTargetOverride.create({
                    data: {
                        tipDayId,
                        entryId,
                        field: TipTargetField.ENTRY_ADJUSTMENT,
                        previousValue,
                        newValue,
                        reason: reason ? `${note} — ${reason}` : note,
                        changedByCloverId,
                        changedByName
                    }
                });

            for (const change of changes.entries ?? []) {
                const found = day.shifts
                    .flatMap(s => s.entries.map(e => ({ entry: e, shift: s })))
                    .find(({ entry }) => entry.id === change.entryId);
                if (!found) {
                    throw new TipValidationError('No se encontró una de las personas a editar.');
                }
                const { entry, shift } = found;
                const who = `${entry.employeeName} (${shiftLabel(shift.orderIndex)})`;

                if (change.creditTips !== undefined) {
                    await logChange(entry.creditTips, change.creditTips, `${who}: propina con tarjeta`, entry.id);
                }
                if (change.serviceCharge !== undefined) {
                    await logChange(entry.serviceCharge, change.serviceCharge, `${who}: cargo por servicio`, entry.id);
                }
                if (change.cashTips !== undefined) {
                    // A null previous value logs as 0 — the column is required —
                    // and the note records that it had not been counted.
                    const had = entry.cashTips;
                    await logChange(
                        had ?? 0,
                        change.cashTips ?? 0,
                        `${who}: efectivo${had === null ? ' (sin contar antes)' : ''}${change.cashTips === null ? ' (marcado sin contar)' : ''}`,
                        entry.id
                    );
                }

                await tx.tipShiftEntry.update({
                    where: { id: change.entryId },
                    data: {
                        creditTips: change.creditTips !== undefined ? change.creditTips : undefined,
                        serviceCharge: change.serviceCharge !== undefined ? change.serviceCharge : undefined,
                        // null is meaningful (not counted), so only undefined skips.
                        cashTips: change.cashTips !== undefined ? change.cashTips : undefined
                    }
                });
            }

            const totals: [keyof TipDayChanges, 'totalCreditTips' | 'totalServiceCharge' | 'totalCashTips', string][] = [
                ['totalCreditTips', 'totalCreditTips', 'Total propinas con tarjeta'],
                ['totalServiceCharge', 'totalServiceCharge', 'Total cargo por servicio'],
                ['totalCashTips', 'totalCashTips', 'Total propinas en efectivo']
            ];
            for (const [key, column, note] of totals) {
                const next = changes[key] as number | undefined;
                if (next === undefined) continue;
                await logChange(day[column], next, note);
                await tx.tipDay.update({ where: { id: tipDayId }, data: { [column]: next } });
            }

            // Same cent-exact check as submission: an admin edit may not leave
            // the day out of balance.
            const problem = await findReconciliationError(tx, tipDayId);
            if (problem) throw new TipValidationError(problem);
        });

        revalidatePath(TIPS_ROUTE);
        return { success: true };
    } catch (e) {
        if (e instanceof TipValidationError) return { success: false, error: e.message };
        console.error('Failed to admin-update submitted day:', e);
        return { success: false, error: 'No se pudieron guardar los cambios.' };
    }
}

/** Return a submitted day to draft, leaving a record of who reopened it. */
export async function reopenTipDay(
    tipDayId: string,
    changedByCloverId: string,
    changedByName: string,
    reason?: string
): Promise<{ success: boolean; error?: string }> {
    if (!(await isAdminSession())) {
        return { success: false, error: 'No tienes permiso para reabrir un día enviado.' };
    }
    if (!changedByCloverId) return { success: false, error: 'Falta identificar quién reabre el día.' };

    try {
        await prisma.$transaction(async tx => {
            const day = await tx.tipDay.findUnique({
                where: { id: tipDayId },
                select: { status: true }
            });
            if (!day) throw new TipValidationError('No se encontró el día de propinas.');
            if (day.status !== TipDayStatus.ENVIADO) {
                throw new TipValidationError('Este día no está enviado.');
            }

            await tx.tipTargetOverride.create({
                data: {
                    tipDayId,
                    field: TipTargetField.SUBMISSION_REOPENED,
                    // Not a monetary change; the columns are required, so both
                    // sides log as 0 and the meaning lives in the field value.
                    previousValue: 0,
                    newValue: 0,
                    reason: reason ?? null,
                    changedByCloverId,
                    changedByName
                }
            });

            await tx.tipDay.update({
                where: { id: tipDayId },
                data: {
                    status: TipDayStatus.BORRADOR,
                    submittedAt: null,
                    submittedByCloverId: null,
                    submittedByName: null
                }
            });
        });

        revalidatePath(TIPS_ROUTE);
        return { success: true };
    } catch (e) {
        if (e instanceof TipValidationError) return { success: false, error: e.message };
        console.error('Failed to reopen tip day:', e);
        return { success: false, error: 'No se pudo reabrir el día.' };
    }
}
