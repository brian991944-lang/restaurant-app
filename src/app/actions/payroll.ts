'use server';

import prisma from '@/lib/prisma';
import { Prisma, TipEntryRole, Department } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { isAdminSession } from '@/lib/adminGuard';
import { getBusinessDate, businessDateToUtcDate } from '@/lib/businessDay';
import { addDays, lastCompleteWeekEnding } from '@/lib/payrollWeek';

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
    /** A single DAY carried both roles, so its hours could not be attributed. */
    | 'DIA_AMBOS_ROLES'
    | 'HORAS_SIN_PROPINAS'
    | 'PROPINAS_SIN_HORAS'
    | 'MARCAJE_MARCADO'
    | 'SIN_ID_CLOVER'
    | 'SIN_TARIFA';

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
    /**
     * Null when no rate could be resolved — no EmployeeRate row AND no tip role
     * to fall back on. Deliberately not zero: a wage of $0.00 reads as a
     * calculated figure, and this is the absence of one.
     */
    hourlyRate: number | null;
    /** True when hourlyRate came from the person's own EmployeeRate row. */
    rateFromConfig: boolean;
    /**
     * One entry per distinct role worked that week, hours summed. A day that
     * contained BOTH roles contributes all its hours to the dominant one —
     * nothing in the data says how to divide them, so the DIA_AMBOS_ROLES flag
     * carries that signal instead of an invented split.
     */
    rateBreakdown: { role: TipEntryRole; hours: number; rate: number }[];
    /**
     * Wages earned, summed from the per-day figures. AUTHORITATIVE — the table
     * renders this rather than multiplying hours by a rate, because a blended
     * rate is a repeating decimal and the two would disagree by cents.
     */
    weekWageCents: number | null;
    /**
     * weekWage / hours: the weighted average actually paid. DISPLAY ONLY. Never
     * multiply by it — that is what weekWageCents is for. Null when no hours
     * were worked, since there is nothing to average.
     */
    effectiveRate: number | null;
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

/**
 * The role-based fallback rate. Takes a known role only — the old signature
 * accepted null and quietly returned serverRate, which is how a Line Cook with
 * no tip role ended up priced as a server.
 */
function rateForRole(role: TipEntryRole, cfg: RateConfig): number {
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

    const [rateConfig, punches, tipEntries, week, retentions, employeeRates] = await Promise.all([
        getRateConfig(),
        prisma.payrollPunch.findMany({
            where: { businessDate: { gte: start, lte: end } },
            select: {
                cloverEmployeeId: true, employeeName: true, hours: true,
                isFlagged: true, businessDate: true,
            },
        }),
        // TipShiftEntry carries no date of its own — the business date lives two
        // relations up, on TipDay, and is selected through that path so each
        // entry can be attributed to the day it was earned.
        prisma.tipShiftEntry.findMany({
            where: { tipShift: { tipDay: { businessDate: { gte: start, lte: end } } } },
            select: {
                cloverEmployeeId: true, employeeName: true, role: true,
                creditTips: true, serviceCharge: true,
                tipShift: { select: { tipDay: { select: { businessDate: true } } } },
            },
        }),
        prisma.payrollWeek.findUnique({
            where: { weekEnding: end },
            include: { entries: true },
        }),
        prisma.retentionSetting.findMany(),
        prisma.employeeRate.findMany(),
    ]);

    type Acc = {
        cloverEmployeeId: string | null;
        employeeName: string;
        hours: number;
        tips: number;
        roleCounts: Map<TipEntryRole, number>;
        /** Hours worked, keyed by business date — the basis for a per-day rate. */
        hoursByDate: Map<string, number>;
        /** Tip-entry counts per role, keyed by business date. */
        rolesByDate: Map<string, Map<TipEntryRole, number>>;
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
                hoursByDate: new Map(), rolesByDate: new Map(),
                hasFlaggedPunch: false, sawPunch: false, sawTip: false,
            };
            rows.set(key, acc);
        }
        return acc;
    };

    /** A @db.Date value as the 'YYYY-MM-DD' key both sides group by. */
    const dayKey = (d: Date) => d.toISOString().slice(0, 10);

    /** Whichever role appears on more entries. Ties to MESERO, as before. */
    const dominant = (counts: Map<TipEntryRole, number>): TipEntryRole | null => {
        if (counts.size === 0) return null;
        const mesero = counts.get(TipEntryRole.MESERO) ?? 0;
        const busser = counts.get(TipEntryRole.BUSSER) ?? 0;
        return busser > mesero ? TipEntryRole.BUSSER : TipEntryRole.MESERO;
    };

    // Punches. A punch whose name never matched the Clover roster has no id, so
    // it is bucketed by NAME instead of being grouped away into nothing — those
    // hours were worked and must stay visible even though no tips can pair
    // with them.
    for (const p of punches) {
        const key = p.cloverEmployeeId ?? `name:${p.employeeName}`;
        const acc = touch(key, p.cloverEmployeeId, p.employeeName);
        const hrs = dec(p.hours);
        const day = dayKey(p.businessDate);
        acc.hours += hrs;
        acc.hoursByDate.set(day, (acc.hoursByDate.get(day) ?? 0) + hrs);
        acc.sawPunch = true;
        if (p.isFlagged) acc.hasFlaggedPunch = true;
    }

    // Tips.
    for (const e of tipEntries) {
        const acc = touch(e.cloverEmployeeId, e.cloverEmployeeId, e.employeeName);
        acc.tips += dec(e.creditTips) + dec(e.serviceCharge);
        acc.sawTip = true;
        acc.roleCounts.set(e.role, (acc.roleCounts.get(e.role) ?? 0) + 1);

        const day = dayKey(e.tipShift.tipDay.businessDate);
        if (!acc.rolesByDate.has(day)) acc.rolesByDate.set(day, new Map());
        const dayRoles = acc.rolesByDate.get(day)!;
        dayRoles.set(e.role, (dayRoles.get(e.role) ?? 0) + 1);
    }

    // Anyone already saved for this week stays on screen even if their punches
    // or tips were later removed — a settled row must not silently disappear.
    for (const entry of week?.entries ?? []) {
        touch(entry.cloverEmployeeId, entry.cloverEmployeeId, entry.employeeName);
    }

    const savedByEmployee = new Map((week?.entries ?? []).map(e => [e.cloverEmployeeId, e]));
    const retentionByEmployee = new Map(retentions.map(r => [r.cloverEmployeeId, r]));
    const rateByEmployee = new Map(employeeRates.map(r => [r.cloverEmployeeId, r]));

    const result: PayrollRow[] = [...rows.entries()].map(([key, acc]) => {
        const roles = [...acc.roleCounts.keys()];

        // The week's dominant role, used as the per-day fallback and as the one
        // value PayrollEntry.role can hold.
        let role: TipEntryRole | null = dominant(acc.roleCounts);
        if (role === null) {
            // No tips this week means no role was indicated. Fall back to the
            // last settled role if there is one; otherwise nothing resolves and
            // HORAS_SIN_PROPINAS marks the row for a human to check.
            role = savedByEmployee.get(acc.cloverEmployeeId ?? '')?.role ?? null;
        }

        const saved = acc.cloverEmployeeId ? savedByEmployee.get(acc.cloverEmployeeId) : undefined;
        const retention = acc.cloverEmployeeId ? retentionByEmployee.get(acc.cloverEmployeeId) : undefined;

        // Rate resolution, most specific first: the person's own configured
        // rate, then the role-based fallback, then nothing. Falling through to
        // serverRate for someone with no role at all is what priced kitchen
        // staff as servers; an unresolved rate is now reported as unresolved.
        const configured = acc.cloverEmployeeId ? rateByEmployee.get(acc.cloverEmployeeId) : undefined;
        const hourlyRate =
            configured ? dec(configured.hourlyRate)
                : role ? rateForRole(role, rateConfig)
                    : null;

        // ── Per-day wage ──
        //
        // A configured rate is the person's rate, full stop: it does not vary by
        // what they happened to do on a given day, so their week is one bucket.
        //
        // Everyone else is priced day by day. Someone who bussed Tuesday and
        // served Friday earned two different rates that week, and pricing the
        // whole week at whichever role happened to dominate over- or under-pays
        // every hour of the other one.
        const hoursByRole = new Map<TipEntryRole, number>();
        let weekWageCents: number | null = null;
        let mixedDay = false;

        if (hourlyRate !== null) {
            if (configured) {
                weekWageCents = Math.round(acc.hours * hourlyRate * 100);
                if (role) hoursByRole.set(role, acc.hours);
            } else {
                let total = 0;
                for (const [day, dayHours] of acc.hoursByDate) {
                    const dayCounts = acc.rolesByDate.get(day);
                    if (dayCounts && dayCounts.size > 1) mixedDay = true;
                    // The role recorded that day, or the week's dominant role
                    // when the day carried no tips at all.
                    const dayRole = dominant(dayCounts ?? new Map()) ?? role!;
                    total += dayHours * rateForRole(dayRole, rateConfig);
                    hoursByRole.set(dayRole, (hoursByRole.get(dayRole) ?? 0) + dayHours);
                }
                // Summed first, rounded ONCE. Rounding each day and adding the
                // results compounds rounding across steps — it shifts a week by
                // a cent or two for no reason, and nobody is paid daily here, so
                // the week total is the only figure that has to be exact.
                weekWageCents = Math.round(total * 100);
            }
        }

        const rateBreakdown = [...hoursByRole.entries()]
            .map(([r, hours]) => ({ role: r, hours, rate: configured ? hourlyRate! : rateForRole(r, rateConfig) }))
            .sort((a, b) => b.hours - a.hours);

        // Display only. Deliberately not rounded here — the table formats it,
        // and nothing multiplies by it.
        const effectiveRate =
            weekWageCents !== null && acc.hours > 0 ? weekWageCents / 100 / acc.hours : null;

        const flags: PayrollRowFlag[] = [];
        // A week containing both roles is no longer an approximation — it is
        // priced correctly day by day. Only a single DAY holding both is still
        // unresolvable, because those hours cannot be split.
        if (mixedDay) flags.push('DIA_AMBOS_ROLES');
        if (acc.sawPunch && !acc.sawTip) flags.push('HORAS_SIN_PROPINAS');
        if (acc.sawTip && !acc.sawPunch) flags.push('PROPINAS_SIN_HORAS');
        if (acc.hasFlaggedPunch) flags.push('MARCAJE_MARCADO');
        if (!acc.cloverEmployeeId) flags.push('SIN_ID_CLOVER');
        if (hourlyRate === null) flags.push('SIN_TARIFA');

        return {
            key,
            cloverEmployeeId: acc.cloverEmployeeId,
            employeeName: acc.employeeName,
            hoursWorked: acc.hours,
            tipsTotal: acc.tips,
            roles,
            role,
            hourlyRate,
            rateFromConfig: !!configured,
            rateBreakdown,
            weekWageCents,
            effectiveRate,
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

        // Refusing rather than storing 0: a settled entry records the rate the
        // person was paid at, and a zero there is indistinguishable from a real
        // wage of nothing once the week is closed.
        if (row.hourlyRate === null) {
            return { success: false, error: 'Esta persona no tiene tarifa configurada. Configúrala antes de guardar su nómina.' };
        }

        const checkTips = Math.max(0, row.tipsTotal - adpTips);
        const end = businessDateToUtcDate(weekEnding);

        // The stored rate is a BLEND when the week spanned more than one role:
        // the weighted average of the daily rates, rounded to 2dp for the
        // column. hoursWorked x hourlyRate therefore does not reliably
        // reproduce wageTotal, which is why the wage is stored rather than
        // implied — wageTotal is what was actually earned, summed per day before
        // any rate rounding. row.rateBreakdown is the detail behind the blend;
        // it is not persisted, so a settled row records the amount, not its
        // derivation.
        //
        // effectiveRate is null only when no hours were worked, and then there
        // is nothing to average — the nominal resolved rate stands in, matching
        // the old behaviour for a tips-only week.
        const storedRate = row.effectiveRate ?? row.hourlyRate;
        const wageTotal = (row.weekWageCents ?? 0) / 100;

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
                hourlyRate: storedRate.toFixed(2),
                wageTotal: wageTotal.toFixed(2),
                tipsTotal: row.tipsTotal.toFixed(2),
                adpTips: adpTips.toFixed(2),
                checkTips: checkTips.toFixed(2),
            },
            update: {
                employeeName: row.employeeName,
                role: row.role ?? TipEntryRole.MESERO,
                hoursWorked: row.hoursWorked.toFixed(2),
                hourlyRate: storedRate.toFixed(2),
                wageTotal: wageTotal.toFixed(2),
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

// ─────────────────────────────────────────────────────────────
// Per-person configuration
// ─────────────────────────────────────────────────────────────

/** How far back to look for people who have worked but are not configured. */
const CONFIG_LOOKBACK_DAYS = 90;

export type EmployeeConfigRow = {
    cloverEmployeeId: string;
    employeeName: string;
    hourlyRate: number | null;
    department: Department | null;
    adpHours: number | null;
    adpRate: number | null;
    /** False for someone active in the window with no EmployeeRate row yet. */
    hasRow: boolean;
    /** Every tip role seen in the lookback window. */
    rolesSeen: TipEntryRole[];
    /**
     * True when the person has worked under more than one role recently, so the
     * role-based fallback would price them differently week to week. Configuring
     * them is what removes that swing.
     */
    roleVaries: boolean;
};

/**
 * Everyone who needs a payroll configuration, configured or not.
 *
 * Anyone with punches or tips in the last CONFIG_LOOKBACK_DAYS days is included
 * even with no EmployeeRate row — those people are the entire point of the
 * screen, and listing only existing rows would hide exactly the ones that need
 * attention.
 */
export async function getEmployeeConfigs(): Promise<EmployeeConfigRow[]> {
    const since = businessDateToUtcDate(addDays(getBusinessDate(), -CONFIG_LOOKBACK_DAYS));

    const [rates, punches, tipEntries] = await Promise.all([
        prisma.employeeRate.findMany(),
        prisma.payrollPunch.groupBy({
            by: ['cloverEmployeeId', 'employeeName'],
            where: { businessDate: { gte: since }, cloverEmployeeId: { not: null } },
        }),
        prisma.tipShiftEntry.findMany({
            where: { tipShift: { tipDay: { businessDate: { gte: since } } } },
            select: { cloverEmployeeId: true, employeeName: true, role: true },
        }),
    ]);

    const names = new Map<string, string>();
    const rolesById = new Map<string, Set<TipEntryRole>>();

    for (const p of punches) {
        if (p.cloverEmployeeId) names.set(p.cloverEmployeeId, p.employeeName);
    }
    for (const e of tipEntries) {
        names.set(e.cloverEmployeeId, e.employeeName);
        if (!rolesById.has(e.cloverEmployeeId)) rolesById.set(e.cloverEmployeeId, new Set());
        rolesById.get(e.cloverEmployeeId)!.add(e.role);
    }
    // A configured person stays listed even after 90 quiet days — their row is
    // still what payroll reads, so it must remain editable.
    for (const r of rates) names.set(r.cloverEmployeeId, r.employeeName);

    const byId = new Map(rates.map(r => [r.cloverEmployeeId, r]));

    return [...names.entries()]
        .map(([cloverEmployeeId, employeeName]) => {
            const row = byId.get(cloverEmployeeId);
            const rolesSeen = [...(rolesById.get(cloverEmployeeId) ?? [])];
            return {
                cloverEmployeeId,
                employeeName: row?.employeeName ?? employeeName,
                hourlyRate: row ? dec(row.hourlyRate) : null,
                department: row?.department ?? null,
                adpHours: row?.adpHours ? dec(row.adpHours) : null,
                adpRate: row?.adpRate ? dec(row.adpRate) : null,
                hasRow: !!row,
                rolesSeen,
                roleVaries: rolesSeen.length > 1,
            };
        })
        // Unconfigured first — they are what the screen exists to fix — then by
        // name within each group.
        .sort((a, b) =>
            a.hasRow === b.hasRow
                ? a.employeeName.localeCompare(b.employeeName, 'es')
                : (a.hasRow ? 1 : -1)
        );
}

/**
 * Save one person's payroll configuration.
 *
 * adpHours and adpRate accept null and MUST keep accepting it: null is not
 * "unset pending a real value", it is the meaningful default — all hours worked,
 * and their real rate respectively.
 */
export async function saveEmployeeConfig(
    cloverEmployeeId: string,
    employeeName: string,
    hourlyRate: number,
    department: Department | null,
    adpHours: number | null,
    adpRate: number | null
): Promise<{ success: boolean; error?: string }> {
    if (!(await isAdminSession())) {
        return { success: false, error: 'No tienes permiso para cambiar la configuración.' };
    }
    if (!cloverEmployeeId) {
        return { success: false, error: 'Falta identificar a la persona.' };
    }
    if (!Number.isFinite(hourlyRate) || hourlyRate <= 0) {
        return { success: false, error: 'La tarifa real debe ser mayor que cero.' };
    }
    if (adpHours !== null && (!Number.isFinite(adpHours) || adpHours < 0)) {
        return { success: false, error: 'Las horas de ADP deben ser un número positivo, o vacío para todas las horas.' };
    }
    if (adpRate !== null && (!Number.isFinite(adpRate) || adpRate < 0)) {
        return { success: false, error: 'La tarifa de ADP debe ser un número positivo, o vacío para usar la tarifa real.' };
    }

    try {
        const data = {
            employeeName,
            hourlyRate: hourlyRate.toFixed(2),
            department,
            adpHours: adpHours === null ? null : adpHours.toFixed(2),
            adpRate: adpRate === null ? null : adpRate.toFixed(2),
        };

        await prisma.employeeRate.upsert({
            where: { cloverEmployeeId },
            create: { cloverEmployeeId, ...data },
            update: data,
        });

        revalidatePath(PAYROLL_ROUTE);
        return { success: true };
    } catch (e) {
        return { success: false, error: `No se pudo guardar la configuración: ${e instanceof Error ? e.message : String(e)}` };
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
