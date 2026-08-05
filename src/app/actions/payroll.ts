'use server';

import prisma from '@/lib/prisma';
import { Prisma, TipEntryRole } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { isAdminSession } from '@/lib/adminGuard';
import { getBusinessDate, getBusinessDayOfWeek, businessDateToUtcDate } from '@/lib/businessDay';

const PAYROLL_ROUTE = '/[locale]/payroll';

/** Prisma Decimal does not cross the server/client boundary — convert explicitly. */
const dec = (d: Prisma.Decimal): number => d.toNumber();

/**
 * Opening figures for the singleton, used only when no row exists yet.
 * These are the real current rates, not placeholders.
 */
const RATE_DEFAULTS = {
    serverRate: 6.05,
    busserRate: 8.50,
    minimumWage: 15.92,
    cushionAmount: 20.00,
} as const;

const isBusinessDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Whole-day arithmetic on a 'YYYY-MM-DD' string. No timezone involved. */
function addDays(dateStr: string, days: number): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + days));
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/**
 * The Sunday that ends the most recent COMPLETE week.
 *
 * The week in progress is deliberately excluded: on a Sunday the day itself is
 * not over, so the answer is the Sunday before. Payroll for a week nobody has
 * finished working would be wrong every time it was opened.
 */
function lastCompleteWeekEnding(today = getBusinessDate()): string {
    const dow = getBusinessDayOfWeek(today);   // 0 = Sunday
    return addDays(today, -(dow === 0 ? 7 : dow));
}

// ─────────────────────────────────────────────────────────────
// Rate config
// ─────────────────────────────────────────────────────────────

export type RateConfig = {
    serverRate: number;
    busserRate: number;
    minimumWage: number;
    cushionAmount: number;
};

/**
 * The singleton rate config, created with the current real rates on first read.
 *
 * Creating on read is deliberate: the page cannot render wages without rates,
 * and an admin editing four visible numbers is a better first experience than
 * an empty panel that errors.
 */
export async function getRateConfig(): Promise<RateConfig> {
    const row = await prisma.payrollRateConfig.upsert({
        where: { id: 'singleton' },
        create: { id: 'singleton', ...RATE_DEFAULTS },
        update: {},
    });
    return {
        serverRate: dec(row.serverRate),
        busserRate: dec(row.busserRate),
        minimumWage: dec(row.minimumWage),
        cushionAmount: dec(row.cushionAmount),
    };
}

export async function saveRateConfig(
    serverRate: number,
    busserRate: number,
    minimumWage: number,
    cushionAmount: number
): Promise<{ success: boolean; error?: string }> {
    if (!(await isAdminSession())) {
        return { success: false, error: 'No tienes permiso para cambiar las tarifas.' };
    }

    const values = { serverRate, busserRate, minimumWage, cushionAmount };
    for (const [, v] of Object.entries(values)) {
        if (!Number.isFinite(v) || v < 0) {
            return { success: false, error: 'Las tarifas deben ser números positivos.' };
        }
    }

    try {
        await prisma.payrollRateConfig.upsert({
            where: { id: 'singleton' },
            create: { id: 'singleton', ...values },
            update: values,
        });
        revalidatePath(PAYROLL_ROUTE);
        return { success: true };
    } catch (e) {
        return { success: false, error: `No se pudieron guardar las tarifas: ${e instanceof Error ? e.message : String(e)}` };
    }
}

// ─────────────────────────────────────────────────────────────
// Weekly view
// ─────────────────────────────────────────────────────────────

export type PayrollRowFlag =
    | 'AMBOS_ROLES'
    | 'HORAS_SIN_PROPINAS'
    | 'PROPINAS_SIN_HORAS'
    | 'MARCAJE_MARCADO'
    | 'SIN_ID_CLOVER';

export type PayrollRow = {
    /** Stable row identity: the Clover id, or `name:<name>` when unmatched. */
    key: string;
    cloverEmployeeId: string | null;
    employeeName: string;
    hoursWorked: number;
    tipsTotal: number;
    /** Every role seen in the week. Length > 1 means the person worked both. */
    roles: TipEntryRole[];
    /** The role the rate is taken from. Null only when nothing indicated one. */
    role: TipEntryRole | null;
    hourlyRate: number;
    savedAdpTips: number | null;
    savedCheckTips: number | null;
    retentionActive: boolean;
    retentionPercentage: number;
    flags: PayrollRowFlag[];
};

export type PayrollWeekView = {
    weekEnding: string;
    weekStart: string;
    /** True when this is the most recent complete week — disables "next". */
    isLatestComplete: boolean;
    rows: PayrollRow[];
    rateConfig: RateConfig;
};

/** Which configured rate a role is paid at. */
function rateFor(role: TipEntryRole | null, cfg: RateConfig): number {
    return role === TipEntryRole.BUSSER ? cfg.busserRate : cfg.serverRate;
}

/**
 * One week of payroll, computed fresh from punches and tips.
 *
 * Nothing here is read from PayrollEntry except the two figures a human typed
 * (adpTips / checkTips). Hours, tips and rate are recomputed on every view so
 * the screen always reflects current data; the settled copies live on
 * PayrollEntry and are written only by savePayrollEntry.
 */
export async function getPayrollWeek(weekEnding?: string): Promise<PayrollWeekView> {
    const latest = lastCompleteWeekEnding();
    const endStr = weekEnding && isBusinessDate(weekEnding) ? weekEnding : latest;
    const startStr = addDays(endStr, -6);

    const start = businessDateToUtcDate(startStr);
    const end = businessDateToUtcDate(endStr);

    const [rateConfig, punches, tipEntries, week, retentions] = await Promise.all([
        getRateConfig(),
        prisma.payrollPunch.findMany({
            where: { businessDate: { gte: start, lte: end } },
            select: { cloverEmployeeId: true, employeeName: true, hours: true, isFlagged: true },
        }),
        // TipShiftEntry carries no date of its own — the business date lives two
        // relations up, on TipDay.
        prisma.tipShiftEntry.findMany({
            where: { tipShift: { tipDay: { businessDate: { gte: start, lte: end } } } },
            select: {
                cloverEmployeeId: true, employeeName: true, role: true,
                creditTips: true, serviceCharge: true,
            },
        }),
        prisma.payrollWeek.findUnique({
            where: { weekEnding: end },
            include: { entries: true },
        }),
        prisma.retentionSetting.findMany(),
    ]);

    type Acc = {
        cloverEmployeeId: string | null;
        employeeName: string;
        hours: number;
        tips: number;
        roleCounts: Map<TipEntryRole, number>;
        hasFlaggedPunch: boolean;
        sawPunch: boolean;
        sawTip: boolean;
    };

    const rows = new Map<string, Acc>();
    const touch = (key: string, cloverEmployeeId: string | null, employeeName: string): Acc => {
        let acc = rows.get(key);
        if (!acc) {
            acc = {
                cloverEmployeeId, employeeName,
                hours: 0, tips: 0, roleCounts: new Map(),
                hasFlaggedPunch: false, sawPunch: false, sawTip: false,
            };
            rows.set(key, acc);
        }
        return acc;
    };

    // Punches. A punch whose name never matched the Clover roster has no id, so
    // it is bucketed by NAME instead of being grouped away into nothing — those
    // hours were worked and must stay visible even though no tips can pair
    // with them.
    for (const p of punches) {
        const key = p.cloverEmployeeId ?? `name:${p.employeeName}`;
        const acc = touch(key, p.cloverEmployeeId, p.employeeName);
        acc.hours += dec(p.hours);
        acc.sawPunch = true;
        if (p.isFlagged) acc.hasFlaggedPunch = true;
    }

    // Tips.
    for (const e of tipEntries) {
        const acc = touch(e.cloverEmployeeId, e.cloverEmployeeId, e.employeeName);
        acc.tips += dec(e.creditTips) + dec(e.serviceCharge);
        acc.sawTip = true;
        acc.roleCounts.set(e.role, (acc.roleCounts.get(e.role) ?? 0) + 1);
    }

    // Anyone already saved for this week stays on screen even if their punches
    // or tips were later removed — a settled row must not silently disappear.
    for (const entry of week?.entries ?? []) {
        touch(entry.cloverEmployeeId, entry.cloverEmployeeId, entry.employeeName);
    }

    const savedByEmployee = new Map((week?.entries ?? []).map(e => [e.cloverEmployeeId, e]));
    const retentionByEmployee = new Map(retentions.map(r => [r.cloverEmployeeId, r]));

    const result: PayrollRow[] = [...rows.entries()].map(([key, acc]) => {
        const roles = [...acc.roleCounts.keys()];

        // Dominant role: whichever appears on more tip entries this week, ties
        // to MESERO. PayrollEntry.role holds exactly one, so a person who
        // worked both is reported as both here and flagged, while the rate is
        // taken from the dominant one.
        let role: TipEntryRole | null = null;
        if (roles.length) {
            const mesero = acc.roleCounts.get(TipEntryRole.MESERO) ?? 0;
            const busser = acc.roleCounts.get(TipEntryRole.BUSSER) ?? 0;
            role = busser > mesero ? TipEntryRole.BUSSER : TipEntryRole.MESERO;
        } else {
            // No tips this week means no role was indicated. Fall back to the
            // last settled role if there is one; otherwise the server rate
            // applies and HORAS_SIN_PROPINAS marks the row for a human to check.
            role = savedByEmployee.get(acc.cloverEmployeeId ?? '')?.role ?? null;
        }

        const saved = acc.cloverEmployeeId ? savedByEmployee.get(acc.cloverEmployeeId) : undefined;
        const retention = acc.cloverEmployeeId ? retentionByEmployee.get(acc.cloverEmployeeId) : undefined;

        const flags: PayrollRowFlag[] = [];
        if (roles.length > 1) flags.push('AMBOS_ROLES');
        if (acc.sawPunch && !acc.sawTip) flags.push('HORAS_SIN_PROPINAS');
        if (acc.sawTip && !acc.sawPunch) flags.push('PROPINAS_SIN_HORAS');
        if (acc.hasFlaggedPunch) flags.push('MARCAJE_MARCADO');
        if (!acc.cloverEmployeeId) flags.push('SIN_ID_CLOVER');

        return {
            key,
            cloverEmployeeId: acc.cloverEmployeeId,
            employeeName: acc.employeeName,
            hoursWorked: acc.hours,
            tipsTotal: acc.tips,
            roles,
            role,
            hourlyRate: rateFor(role, rateConfig),
            savedAdpTips: saved ? dec(saved.adpTips) : null,
            savedCheckTips: saved ? dec(saved.checkTips) : null,
            retentionActive: retention?.isActive ?? false,
            retentionPercentage: retention ? dec(retention.percentage) : 0,
            flags,
        };
    }).sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'es'));

    return {
        weekEnding: endStr,
        weekStart: startStr,
        isLatestComplete: endStr >= latest,
        rows: result,
        rateConfig,
    };
}

/**
 * Settle one person's week.
 *
 * hoursWorked, hourlyRate and tipsTotal are RECOMPUTED here rather than taken
 * from the client, and stored alongside the typed figures. A punch corrected
 * next month therefore changes the live view but not this settled row — the
 * numbers someone was actually paid against stay recoverable.
 *
 * checkTips is derived from the same snapshot (tipsTotal - adpTips) rather than
 * trusted from the caller, so the three stored figures can never contradict
 * one another.
 */
export async function savePayrollEntry(
    weekEnding: string,
    cloverEmployeeId: string,
    adpTips: number,
    _checkTips?: number
): Promise<{ success: boolean; error?: string }> {
    if (!(await isAdminSession())) {
        return { success: false, error: 'No tienes permiso para guardar la nómina.' };
    }
    if (!isBusinessDate(weekEnding)) {
        return { success: false, error: 'La semana no es válida.' };
    }
    if (!cloverEmployeeId) {
        return { success: false, error: 'Esta persona no está vinculada a Clover, así que no se puede guardar su nómina.' };
    }
    if (!Number.isFinite(adpTips) || adpTips < 0) {
        return { success: false, error: 'Las propinas de ADP deben ser un número positivo.' };
    }

    try {
        const view = await getPayrollWeek(weekEnding);
        const row = view.rows.find(r => r.cloverEmployeeId === cloverEmployeeId);
        if (!row) {
            return { success: false, error: 'No se encontró a esta persona en la semana.' };
        }

        const checkTips = Math.max(0, row.tipsTotal - adpTips);
        const end = businessDateToUtcDate(weekEnding);

        const week = await prisma.payrollWeek.upsert({
            where: { weekEnding: end },
            create: { weekEnding: end },
            update: {},
            select: { id: true },
        });

        await prisma.payrollEntry.upsert({
            where: {
                payrollWeekId_cloverEmployeeId: { payrollWeekId: week.id, cloverEmployeeId },
            },
            create: {
                payrollWeekId: week.id,
                cloverEmployeeId,
                employeeName: row.employeeName,
                role: row.role ?? TipEntryRole.MESERO,
                hoursWorked: row.hoursWorked.toFixed(2),
                hourlyRate: row.hourlyRate.toFixed(2),
                tipsTotal: row.tipsTotal.toFixed(2),
                adpTips: adpTips.toFixed(2),
                checkTips: checkTips.toFixed(2),
            },
            update: {
                employeeName: row.employeeName,
                role: row.role ?? TipEntryRole.MESERO,
                hoursWorked: row.hoursWorked.toFixed(2),
                hourlyRate: row.hourlyRate.toFixed(2),
                tipsTotal: row.tipsTotal.toFixed(2),
                adpTips: adpTips.toFixed(2),
                checkTips: checkTips.toFixed(2),
            },
        });

        revalidatePath(PAYROLL_ROUTE);
        return { success: true };
    } catch (e) {
        return { success: false, error: `No se pudo guardar la nómina: ${e instanceof Error ? e.message : String(e)}` };
    }
}

export async function saveRetentionSetting(
    cloverEmployeeId: string,
    employeeName: string,
    isActive: boolean,
    percentage: number
): Promise<{ success: boolean; error?: string }> {
    if (!(await isAdminSession())) {
        return { success: false, error: 'No tienes permiso para cambiar la retención.' };
    }
    if (!cloverEmployeeId) {
        return { success: false, error: 'Esta persona no está vinculada a Clover, así que no se puede guardar su retención.' };
    }
    if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
        return { success: false, error: 'El porcentaje debe estar entre 0 y 100.' };
    }

    try {
        await prisma.retentionSetting.upsert({
            where: { cloverEmployeeId },
            create: { cloverEmployeeId, employeeName, isActive, percentage: percentage.toFixed(2) },
            update: { employeeName, isActive, percentage: percentage.toFixed(2) },
        });
        revalidatePath(PAYROLL_ROUTE);
        return { success: true };
    } catch (e) {
        return { success: false, error: `No se pudo guardar la retención: ${e instanceof Error ? e.message : String(e)}` };
    }
}
