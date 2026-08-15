'use server';

import prisma from '@/lib/prisma';
import { Prisma, TipEntryRole, Department, RetentionKind } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { isAdminSession } from '@/lib/adminGuard';
import { getBusinessDate, businessDateToUtcDate } from '@/lib/businessDay';
import { addDays, lastCompleteWeekEnding, resolveWeekRange, sundayOf } from '@/lib/payrollWeek';
import { calcPaySplit, advanceStatus, type AdvanceStatus } from '@/lib/payrollCalc';
import { cloverFetch } from '@/lib/clover';
import { parseAdpLiabilityRows, type AdpLiabilityParseResult } from '@/lib/adpLiabilityParse';
import { xlsxToRows } from '@/lib/adpLiabilitySheet';
import { toCents } from '@/lib/money';

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
    | 'SIN_TARIFA'
    /** No department resolved, so the row appears in NEITHER tab. */
    | 'SIN_DEPARTAMENTO';

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
     * Which tab the row belongs under. Null means unresolved, and an unresolved
     * row appears under NEITHER tab: leaving someone unassigned is how they are
     * deliberately kept out of payroll. Because that hides people rather than
     * duplicating them, the table counts these rows and names them in a notice
     * above the tabs — nobody with hours may disappear silently.
     */
    department: Department | null;
    /** From EmployeeRate. Null means all hours / their real rate respectively. */
    adpHours: number | null;
    adpRate: number | null;
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

/** The one Clover role that carries a department. Nothing else does. */
const WAIT_STAFF_ROLE = 'wait staff';

/**
 * Which department a person belongs to, most trustworthy source first.
 *
 * Still database-only — cloverRole is the CACHED role, read from the row like
 * everything else here. Nothing in this function reaches Clover, so a payroll
 * screen still renders during a Clover outage.
 *
 * 1. department, the manual override. A human said so; nothing outranks that.
 * 2. The cached Clover role, but ONLY Wait Staff, which means SALON. Every other
 *    role resolves nothing and FALLS THROUGH to the next tier — it does not
 *    short-circuit to null. "Employee" is the merchant's generic role and is on
 *    40 of 56 rows; "Accountant", "Manager" and "admin" are back-office. Reading
 *    any of them as a department was the old "not Wait Staff means kitchen"
 *    rule, which put the accountants in the kitchen report. A role that carries
 *    no information must not outrank the tip evidence below it either.
 * 3. A tip entry this week. The tip sheet only ever records MESERO and BUSSER,
 *    so having one is proof of salon — but its absence proves nothing, which is
 *    why this is the last resort rather than a reason to guess kitchen.
 * 4. Null, reported as SIN_DEPARTAMENTO rather than assumed.
 *
 * COCINA is therefore never inferred: it is only ever the manual override.
 *
 * Shared with syncCloverRoles so the summary it reports after a refresh is the
 * same resolution the payroll screen will actually show.
 */
function resolveDepartment(
    configured: { department: Department | null; cloverRole: string | null } | undefined | null,
    sawTip: boolean
): Department | null {
    if (configured?.department) return configured.department;

    if (configured?.cloverRole?.trim().toLowerCase() === WAIT_STAFF_ROLE) return Department.SALON;

    return sawTip ? Department.SALON : null;
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
    const { start: startStr, end: endStr } = resolveWeekRange(weekEnding);

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
        //
        // A row can now exist with NO rate: the Clover role sync creates one so
        // a cached role has somewhere to live, and refuses to invent a wage to
        // do it. So the test is whether the rate itself is set, not whether the
        // row exists — treating any row as a configured rate would price those
        // people at null and flag SIN_TARIFA even when their tip role could
        // have answered.
        const configured = acc.cloverEmployeeId ? rateByEmployee.get(acc.cloverEmployeeId) : undefined;
        const configuredRate = configured?.hourlyRate != null ? dec(configured.hourlyRate) : null;
        const hourlyRate =
            configuredRate !== null ? configuredRate
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
            if (configuredRate !== null) {
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
            .map(([r, hours]) => ({ role: r, hours, rate: configuredRate !== null ? configuredRate : rateForRole(r, rateConfig) }))
            .sort((a, b) => b.hours - a.hours);

        // Display only. Deliberately not rounded here — the table formats it,
        // and nothing multiplies by it.
        const effectiveRate =
            weekWageCents !== null && acc.hours > 0 ? weekWageCents / 100 / acc.hours : null;

        // Department. Still database-only — resolveDepartment reads the CACHED
        // Clover role off the row and never calls Clover, so this action keeps
        // rendering during an outage. See resolveDepartment for the order.
        const department = resolveDepartment(configured, acc.sawTip);

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
        if (department === null) flags.push('SIN_DEPARTAMENTO');

        return {
            key,
            cloverEmployeeId: acc.cloverEmployeeId,
            employeeName: acc.employeeName,
            hoursWorked: acc.hours,
            tipsTotal: acc.tips,
            roles,
            role,
            hourlyRate,
            rateFromConfig: configuredRate !== null,
            department,
            adpHours: configured?.adpHours ? dec(configured.adpHours) : null,
            adpRate: configured?.adpRate ? dec(configured.adpRate) : null,
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
 * hoursWorked, hourlyRate, tipsTotal and the whole wage split are RECOMPUTED
 * here rather than taken from the client, and stored alongside the one typed
 * figure (adpTips). A punch corrected next month therefore changes the live
 * view but not this settled row — the numbers someone was actually paid against
 * stay recoverable.
 *
 * Which pair of money columns gets written depends on the department:
 *
 *   SALÓN  — tips are split by hand into adpTips / checkTips. The wage all goes
 *            through ADP, so adpWage = wageTotal and checkWage = 0.
 *   COCINA — there are no tips, so both tip columns are zero. The WAGE is split
 *            by the person's configured adpHours x adpRate.
 *
 * The kitchen split is recomputed from EmployeeRate here rather than trusted
 * from the screen. That can briefly disagree with what the tablet is showing if
 * the configuration changed since the page rendered; the caller refreshes after
 * a successful save so the row re-renders from the same config the server used.
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

        const end = businessDateToUtcDate(weekEnding);

        // A row with no department belongs to neither side, so there is no
        // correct pair of columns to write. Settling it would record a split
        // that was never decided.
        if (row.department === null) {
            return { success: false, error: 'Esta persona no tiene departamento configurado. Configúralo antes de guardar su nómina.' };
        }

        const isKitchen = row.department === Department.COCINA;

        // Kitchen: the WAGE is split by configuration, recomputed here from the
        // person's own adpHours / adpRate rather than from anything the client
        // sent. Salón: the wage all goes through ADP.
        const split = isKitchen
            ? calcPaySplit({
                hours: row.hoursWorked,
                hourlyRate: row.hourlyRate,
                adpHours: row.adpHours,
                adpRate: row.adpRate,
            })
            : null;

        const wageCents = row.weekWageCents ?? 0;
        const adpWageCents = isKitchen ? split!.adpTotalCents : wageCents;
        const checkWageCents = isKitchen ? split!.checkTotalCents : 0;

        // Kitchen staff receive no tips, so both tip columns are zero rather
        // than carrying whatever the shared save handler happened to send.
        const storedAdpTips = isKitchen ? 0 : adpTips;
        const checkTips = isKitchen ? 0 : Math.max(0, row.tipsTotal - adpTips);

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

        // Written identically on create and update — one object, so the two
        // branches cannot drift apart as columns are added.
        const figures = {
            employeeName: row.employeeName,
            // Null, not MESERO: someone who worked no tipped shift never held a
            // tip role, and a settled record should not claim one.
            role: row.role,
            hoursWorked: row.hoursWorked.toFixed(2),
            hourlyRate: storedRate.toFixed(2),
            wageTotal: wageTotal.toFixed(2),
            tipsTotal: row.tipsTotal.toFixed(2),
            adpTips: storedAdpTips.toFixed(2),
            checkTips: checkTips.toFixed(2),
            adpWage: (adpWageCents / 100).toFixed(2),
            checkWage: (checkWageCents / 100).toFixed(2),
        };

        await prisma.payrollEntry.upsert({
            where: {
                payrollWeekId_cloverEmployeeId: { payrollWeekId: week.id, cloverEmployeeId },
            },
            create: { payrollWeekId: week.id, cloverEmployeeId, ...figures },
            update: figures,
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
    /** The manual override only. Null means the row derives it — see resolveDepartment. */
    department: Department | null;
    /** The cached Clover role, exactly as Clover named it. Null means never synced. */
    cloverRole: string | null;
    /** ISO, or null. A Date would cross the server boundary as one; this is explicit. */
    cloverRoleAt: string | null;
    /** What the row actually resolves to, override and cached role together. */
    resolvedDepartment: Department | null;
    /**
     * What the cached Clover role ALONE would say, ignoring any override. Null
     * when never synced. Computed here rather than in the panel so the Wait
     * Staff rule lives in exactly one place — a second copy in the client would
     * be free to disagree with the one payroll actually pays people by.
     */
    departmentFromRole: Department | null;
    adpHours: number | null;
    adpRate: number | null;
    /**
     * True when a human deliberately configured this person, which means a rate
     * is set. NOT merely "an EmployeeRate row exists": the role sync creates a
     * row for every Clover employee, so row existence stopped distinguishing
     * anyone the moment it shipped, and the panel's "needs attention" highlight
     * would mark nobody. A rate is the thing only a human can put there.
     */
    isConfigured: boolean;
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
 *
 * The inverse is also true and matters more since the role sync started
 * creating rows: an EmployeeRate row is NOT on its own a reason to list someone.
 * The sync creates a row for every Clover employee so their role has somewhere
 * to live, which put 41 of 56 people on this screen who have never worked a
 * shift here. A row is listed only when the person is payroll-relevant:
 *
 *   - they have punches or tips in the lookback window, OR
 *   - they appear in the week being viewed, however old that week is, OR
 *   - their row has an hourlyRate, meaning a human configured them deliberately, OR
 *   - isPinned: a human picked them out of the "add people" modal by hand
 *
 * A sync-created row with no rate and no recent work is none of those, so it is
 * not listed. It is emphatically NOT deleted — the cached role is still what
 * resolves this person's department the day they do start working.
 *
 * isHidden overrides ALL of the above. It is the one way to take somebody off
 * this screen who would otherwise qualify, and it is decluttering only: nothing
 * here feeds getPayrollWeek, so a hidden person with hours still appears in the
 * report for that week and still gets paid.
 *
 * `week` is the range the page is currently showing. Passing it is what keeps
 * the SIN_DEPARTAMENTO notice honest: that notice names people and links here,
 * and for a week older than the lookback window the person it named would
 * otherwise be missing from this list.
 */
export async function getEmployeeConfigs(week?: { start: string; end: string }): Promise<EmployeeConfigRow[]> {
    const since = businessDateToUtcDate(addDays(getBusinessDate(), -CONFIG_LOOKBACK_DAYS));

    // The lookback window, plus the viewed week when it falls outside it. An OR
    // rather than simply extending `since` back to the viewed week: opening a
    // week from last year should add that week's dozen people, not everybody
    // who has worked since.
    const weekRange = week
        ? { gte: businessDateToUtcDate(week.start), lte: businessDateToUtcDate(week.end) }
        : null;
    const inScope = weekRange
        ? { OR: [{ businessDate: { gte: since } }, { businessDate: weekRange }] }
        : { businessDate: { gte: since } };

    const [rates, punches, tipEntries] = await Promise.all([
        prisma.employeeRate.findMany(),
        prisma.payrollPunch.groupBy({
            by: ['cloverEmployeeId', 'employeeName'],
            where: { ...inScope, cloverEmployeeId: { not: null } },
        }),
        prisma.tipShiftEntry.findMany({
            where: { tipShift: { tipDay: inScope } },
            select: { cloverEmployeeId: true, employeeName: true, role: true },
        }),
    ]);

    const names = new Map<string, string>();
    const rolesById = new Map<string, Set<TipEntryRole>>();

    // Membership of `names` IS the payroll-relevance test: only people seen in
    // scope, or carrying a deliberate rate, are ever added to it.
    for (const p of punches) {
        if (p.cloverEmployeeId) names.set(p.cloverEmployeeId, p.employeeName);
    }
    for (const e of tipEntries) {
        names.set(e.cloverEmployeeId, e.employeeName);
        if (!rolesById.has(e.cloverEmployeeId)) rolesById.set(e.cloverEmployeeId, new Set());
        rolesById.get(e.cloverEmployeeId)!.add(e.role);
    }
    // A CONFIGURED person stays listed even after 90 quiet days — their row is
    // still what payroll reads, so it must remain editable. A rate is what marks
    // them as configured; a bare sync-created row does not qualify. isPinned is
    // the other deliberate signal: somebody added them by hand and has not
    // entered a rate yet, which is exactly the state the panel exists to fix.
    for (const r of rates) {
        if (r.hourlyRate != null || r.isPinned) names.set(r.cloverEmployeeId, r.employeeName);
    }

    // Applied LAST so it beats every rule above, including hours worked. This is
    // the only subtraction in the function.
    for (const r of rates) {
        if (r.isHidden) names.delete(r.cloverEmployeeId);
    }

    const byId = new Map(rates.map(r => [r.cloverEmployeeId, r]));

    return [...names.entries()]
        .map(([cloverEmployeeId, employeeName]) => {
            const row = byId.get(cloverEmployeeId);
            const rolesSeen = [...(rolesById.get(cloverEmployeeId) ?? [])];
            return {
                cloverEmployeeId,
                employeeName: row?.employeeName ?? employeeName,
                hourlyRate: row?.hourlyRate != null ? dec(row.hourlyRate) : null,
                department: row?.department ?? null,
                cloverRole: row?.cloverRole ?? null,
                cloverRoleAt: row?.cloverRoleAt ? row.cloverRoleAt.toISOString() : null,
                // Tip evidence here spans the whole lookback window, not one
                // week, so this can resolve SALON for someone a quiet week
                // would leave unset. That is the right bias for a config
                // screen: it answers "what do we know about this person".
                resolvedDepartment: resolveDepartment(row, rolesSeen.length > 0),
                departmentFromRole: resolveDepartment({ department: null, cloverRole: row?.cloverRole ?? null }, false),
                adpHours: row?.adpHours ? dec(row.adpHours) : null,
                adpRate: row?.adpRate ? dec(row.adpRate) : null,
                isConfigured: row?.hourlyRate != null,
                rolesSeen,
                roleVaries: rolesSeen.length > 1,
            };
        })
        // Unconfigured first — they are what the screen exists to fix — then by
        // name within each group.
        .sort((a, b) =>
            a.isConfigured === b.isConfigured
                ? a.employeeName.localeCompare(b.employeeName, 'es')
                : (a.isConfigured ? 1 : -1)
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

// ─────────────────────────────────────────────────────────────
// Who appears on the config panel
// ─────────────────────────────────────────────────────────────

export type CloverEmployeeRow = {
    cloverEmployeeId: string;
    employeeName: string;
    /** The cached Clover role, exactly as Clover named it. Null means never synced. */
    cloverRole: string | null;
    /** A rate is what marks someone as deliberately configured. */
    hasRate: boolean;
    isHidden: boolean;
    isPinned: boolean;
    /** Punches or tips inside CONFIG_LOOKBACK_DAYS. Drives the hide warning. */
    hasRecentActivity: boolean;
};

/**
 * Everyone the config panel COULD list — the modal's source list.
 *
 * Unlike getEmployeeConfigs this applies no relevance rule and no isHidden
 * filter: the whole point of the modal is to see the people the panel is
 * deliberately not showing you, so filtering here would hide the thing being
 * managed.
 *
 * Reads EmployeeRate only. The role sync creates a row for every Clover
 * employee, so in practice that is everyone; anyone who somehow has punches
 * without a row is already surfaced by getEmployeeConfigs' activity rules.
 */
export async function getAllCloverEmployees(): Promise<CloverEmployeeRow[]> {
    const since = businessDateToUtcDate(addDays(getBusinessDate(), -CONFIG_LOOKBACK_DAYS));

    const [rates, punches, tipEntries] = await Promise.all([
        prisma.employeeRate.findMany(),
        prisma.payrollPunch.groupBy({
            by: ['cloverEmployeeId'],
            where: { businessDate: { gte: since }, cloverEmployeeId: { not: null } },
        }),
        prisma.tipShiftEntry.findMany({
            where: { tipShift: { tipDay: { businessDate: { gte: since } } } },
            select: { cloverEmployeeId: true },
            distinct: ['cloverEmployeeId'],
        }),
    ]);

    const active = new Set<string>();
    for (const p of punches) if (p.cloverEmployeeId) active.add(p.cloverEmployeeId);
    for (const e of tipEntries) active.add(e.cloverEmployeeId);

    return rates
        .map(r => ({
            cloverEmployeeId: r.cloverEmployeeId,
            employeeName: r.employeeName,
            cloverRole: r.cloverRole,
            hasRate: r.hourlyRate != null,
            isHidden: r.isHidden,
            isPinned: r.isPinned,
            hasRecentActivity: active.has(r.cloverEmployeeId),
        }))
        .sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'es'));
}

/**
 * Hide or unhide one person on the config panel.
 *
 * Hiding is decluttering, never exclusion: getPayrollWeek does not read
 * isHidden, so a hidden person who worked still appears in that week's report
 * and is still paid. The modal says so on the button rather than leaving the
 * user to infer it.
 *
 * Unhiding also pins, because clearing isHidden alone would leave someone with
 * no rate and no recent work failing every relevance rule — the row would
 * silently fail to come back.
 */
export async function setEmployeeHidden(
    cloverEmployeeId: string,
    isHidden: boolean
): Promise<{ success: boolean; error?: string }> {
    if (!(await isAdminSession())) {
        return { success: false, error: 'No tienes permiso para cambiar la configuración.' };
    }
    if (!cloverEmployeeId) {
        return { success: false, error: 'Falta identificar a la persona.' };
    }

    try {
        await prisma.employeeRate.update({
            where: { cloverEmployeeId },
            data: isHidden ? { isHidden: true } : { isHidden: false, isPinned: true },
        });

        revalidatePath(PAYROLL_ROUTE);
        return { success: true };
    } catch (e) {
        return { success: false, error: `No se pudo actualizar a la persona: ${e instanceof Error ? e.message : String(e)}` };
    }
}

/**
 * Put someone on the config panel by hand.
 *
 * Sets isPinned and clears isHidden. It deliberately does NOT set a rate: the
 * panel is where a rate is entered, and inventing one here would be the same
 * mistake as defaulting to zero — an invented figure is indistinguishable from
 * a real one once it is in the column.
 *
 * isPinned is what actually makes them appear. See getEmployeeConfigs: without
 * it, a person with no rate and no recent work still matches nothing.
 */
export async function addEmployeeToConfig(
    cloverEmployeeId: string
): Promise<{ success: boolean; error?: string }> {
    if (!(await isAdminSession())) {
        return { success: false, error: 'No tienes permiso para cambiar la configuración.' };
    }
    if (!cloverEmployeeId) {
        return { success: false, error: 'Falta identificar a la persona.' };
    }

    try {
        await prisma.employeeRate.update({
            where: { cloverEmployeeId },
            data: { isPinned: true, isHidden: false },
        });

        revalidatePath(PAYROLL_ROUTE);
        return { success: true };
    } catch (e) {
        return { success: false, error: `No se pudo agregar a la persona: ${e instanceof Error ? e.message : String(e)}` };
    }
}

// ─────────────────────────────────────────────────────────────
// Clover role sync
// ─────────────────────────────────────────────────────────────

export type RoleSyncResult = {
    success: boolean;
    error?: string;
    /** Employees Clover returned. */
    checked: number;
    /** Of those, how many carried a usable role name. */
    withRole: number;
    /** Returned with no role at all. Their cached role is left untouched, not cleared. */
    withoutRole: number;
    /** EmployeeRate rows created for people who had none. */
    created: number;
    /** Everyone whose resolved department moved, and where it moved to. */
    changed: { employeeName: string; from: Department | null; to: Department | null }[];
};

const EMPTY_SYNC = { checked: 0, withRole: 0, withoutRole: 0, created: 0, changed: [] };

/**
 * Refresh every cached Clover role. Explicit user action only — nothing calls
 * this on render, which is the whole reason the role is cached at all.
 *
 * Clover is read through cloverFetch directly rather than through getWaitStaff,
 * for two reasons: getWaitStaff filters by SalonStaffVisibility, so anyone an
 * admin hid there would come back looking like they had no wait-staff role and
 * lose their SALON resolution; and it returns only Wait Staff, so everyone else —
 * the people this sync exists for — would never appear.
 *
 * What it does NOT write is department. That column is the manual override and
 * stays the exclusive record of what a human decided; the derivation happens at
 * read time in resolveDepartment. Freezing a derived value into the override
 * would mean a later role change in Clover never took effect, and would leave
 * nothing to compare a manual choice against.
 */
export async function syncCloverRoles(): Promise<RoleSyncResult> {
    if (!(await isAdminSession())) {
        return { success: false, error: 'No tienes permiso para sincronizar los roles.', ...EMPTY_SYNC };
    }

    // Clover is read FIRST and in full, before a single write. A failure here
    // returns with the database untouched: a sync that half-applied, or that
    // cleared cached roles because Clover was unreachable, would be worse than
    // one that did nothing at all.
    let employees: any[];
    try {
        const data = await cloverFetch('/employees?limit=200&expand=roles');
        employees = data?.elements ?? [];
    } catch (e) {
        return {
            success: false,
            error: `No se pudieron leer los roles desde Clover, así que no se cambió nada: ${e instanceof Error ? e.message : String(e)}`,
            ...EMPTY_SYNC,
        };
    }

    /**
     * The one role name worth caching for this person.
     *
     * Wait Staff wins outright when someone holds several, because it is the
     * role that decides the department. Otherwise the first name alphabetically,
     * so the cached value stays put instead of shifting with Clover's ordering.
     */
    const roleOf = (emp: any): string | null => {
        const names: string[] = (emp?.roles?.elements ?? [])
            .map((r: any) => (typeof r?.name === 'string' ? r.name.trim() : ''))
            .filter((n: string) => n !== '');
        if (names.length === 0) return null;
        return names.find(n => n.toLowerCase() === WAIT_STAFF_ROLE)
            ?? names.sort((a, b) => a.localeCompare(b, 'es'))[0];
    };

    const parsed = employees
        .map((emp: any) => ({
            id: String(emp?.id ?? ''),
            name: String(emp?.nickname || emp?.name || ''),
            role: roleOf(emp),
        }))
        .filter(e => e.id !== '');

    try {
        const [existing, tipEntries] = await Promise.all([
            prisma.employeeRate.findMany({ where: { cloverEmployeeId: { in: parsed.map(e => e.id) } } }),
            // Tip evidence, so the summary reports the department each person
            // will actually resolve to rather than the cached role alone.
            prisma.tipShiftEntry.findMany({
                where: {
                    tipShift: { tipDay: { businessDate: { gte: businessDateToUtcDate(addDays(getBusinessDate(), -CONFIG_LOOKBACK_DAYS)) } } },
                },
                select: { cloverEmployeeId: true },
                distinct: ['cloverEmployeeId'],
            }),
        ]);

        const byId = new Map(existing.map(r => [r.cloverEmployeeId, r]));
        const tipped = new Set(tipEntries.map(e => e.cloverEmployeeId));

        const now = new Date();
        const ops = [];
        const changed: RoleSyncResult['changed'] = [];
        let created = 0;
        let withoutRole = 0;

        for (const e of parsed) {
            const row = byId.get(e.id);

            // Someone Clover returns with no role keeps whatever is cached. An
            // expand that silently stopped expanding looks exactly like every
            // employee losing their role at once, and that must not be able to
            // wipe the cache.
            if (e.role === null) { withoutRole++; continue; }

            const displayName = e.name || row?.employeeName || e.id;
            const sawTip = tipped.has(e.id);

            const before = resolveDepartment(row, sawTip);
            const after = resolveDepartment({ department: row?.department ?? null, cloverRole: e.role }, sawTip);
            if (before !== after) changed.push({ employeeName: displayName, from: before, to: after });

            if (!row) created++;

            ops.push(prisma.employeeRate.upsert({
                where: { cloverEmployeeId: e.id },
                // No hourlyRate and no department: a rate would have to be
                // invented, and the department is derived from the role being
                // written right here.
                create: { cloverEmployeeId: e.id, employeeName: displayName, cloverRole: e.role, cloverRoleAt: now },
                update: { employeeName: displayName, cloverRole: e.role, cloverRoleAt: now },
            }));
        }

        await prisma.$transaction(ops);
        revalidatePath(PAYROLL_ROUTE);

        return {
            success: true,
            checked: parsed.length,
            withRole: parsed.length - withoutRole,
            withoutRole,
            created,
            changed: changed.sort((a, b) => a.employeeName.localeCompare(b.employeeName, 'es')),
        };
    } catch (e) {
        return {
            success: false,
            error: `No se pudieron guardar los roles: ${e instanceof Error ? e.message : String(e)}`,
            ...EMPTY_SYNC,
        };
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

// ─────────────────────────────────────────────────────────────
// Salary advances
// ─────────────────────────────────────────────────────────────

/** Dollars to whole cents. Money crosses this boundary once, here. */
const toCentsExact = (amount: number): number =>
    !Number.isFinite(amount) ? 0 : Math.round(amount * 100);

/** A single repayment already recorded against an advance. */
export type AdvanceDeductionRow = {
    /** RetentionLedger id — what deleteDeduction takes. */
    id: string;
    weekEnding: string;
    amountCents: number;
    recordedByName: string | null;
    createdAt: string;
};

export type AdvanceRow = {
    id: string;
    cloverEmployeeId: string;
    employeeName: string;
    principalCents: number;
    weeklyDeductionCents: number;
    startWeekEnding: string;
    note: string | null;
    isActive: boolean;
    /** Straight from advanceStatus — paid, outstanding, weeks left, missed weeks. */
    status: AdvanceStatus;
    deductions: AdvanceDeductionRow[];
};

/** A Date column read back as the business-date string the rest of payroll uses. */
const dateToBusinessString = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Every advance with its computed repayment status.
 *
 * Deductions come from RetentionLedger rows carrying this advance's id, which is
 * why no running balance is stored anywhere: the ledger IS the record, and a
 * cached total would be a second source of truth free to disagree with it.
 *
 * Gaps are looked for up to the last COMPLETE week. Including the week in
 * progress would report every active advance as missing a payment for the week
 * nobody has finished working yet.
 */
export async function getAdvances(): Promise<AdvanceRow[]> {
    const through = lastCompleteWeekEnding();

    const [advances, ledger, weeks] = await Promise.all([
        prisma.salaryAdvance.findMany(),
        prisma.retentionLedger.findMany({
            where: { kind: RetentionKind.DESCUENTO, advanceId: { not: null } },
            orderBy: { createdAt: 'asc' },
        }),
        prisma.payrollWeek.findMany({ select: { id: true, weekEnding: true } }),
    ]);

    // payrollWeekId holds a PayrollWeek id, so the week a repayment belongs to
    // is resolved through that row rather than parsed out of the column.
    const weekById = new Map(weeks.map(w => [w.id, dateToBusinessString(w.weekEnding)]));

    const byAdvance = new Map<string, AdvanceDeductionRow[]>();
    for (const l of ledger) {
        if (!l.advanceId) continue;
        if (!byAdvance.has(l.advanceId)) byAdvance.set(l.advanceId, []);
        byAdvance.get(l.advanceId)!.push({
            id: l.id,
            weekEnding: (l.payrollWeekId && weekById.get(l.payrollWeekId)) || '',
            amountCents: toCentsExact(dec(l.amount)),
            recordedByName: l.recordedByName,
            createdAt: l.createdAt.toISOString(),
        });
    }

    return advances
        .map(a => {
            const deductions = (byAdvance.get(a.id) ?? []).filter(d => d.weekEnding !== '');
            const principalCents = toCentsExact(dec(a.principalAmount));
            const weeklyDeductionCents = toCentsExact(dec(a.weeklyDeduction));
            const startWeekEnding = dateToBusinessString(a.startWeekEnding);

            return {
                id: a.id,
                cloverEmployeeId: a.cloverEmployeeId,
                employeeName: a.employeeName,
                principalCents,
                weeklyDeductionCents,
                startWeekEnding,
                note: a.note,
                isActive: a.isActive,
                status: advanceStatus({
                    principalCents,
                    weeklyDeductionCents,
                    startWeekEnding,
                    deductions: deductions.map(d => ({ weekEnding: d.weekEnding, amountCents: d.amountCents })),
                    throughWeekEnding: through,
                }),
                deductions: deductions.sort((x, y) => x.weekEnding.localeCompare(y.weekEnding)),
            };
        })
        // Active first — an outstanding debt is the thing to act on — then by name.
        .sort((a, b) =>
            a.isActive === b.isActive
                ? a.employeeName.localeCompare(b.employeeName, 'es')
                : (a.isActive ? -1 : 1)
        );
}

/**
 * Record a new advance handed to a worker.
 *
 * Deliberately writes NO ledger row. The SalaryAdvance record IS the money going
 * out; an ADELANTO row beside it would record the same event twice, and any
 * query summing a person's ledger would have to know to exclude it. Repayments
 * are the only thing the ledger carries for an advance.
 */
export async function createAdvance(
    cloverEmployeeId: string,
    employeeName: string,
    principalAmount: number,
    weeklyDeduction: number,
    startWeekEnding: string,
    note?: string
): Promise<{ success: boolean; error?: string }> {
    if (!(await isAdminSession())) {
        return { success: false, error: 'No tienes permiso para registrar adelantos.' };
    }
    if (!cloverEmployeeId) {
        return { success: false, error: 'Falta identificar a la persona.' };
    }
    if (!Number.isFinite(principalAmount) || principalAmount <= 0) {
        return { success: false, error: 'El monto del adelanto debe ser mayor que cero.' };
    }
    if (!Number.isFinite(weeklyDeduction) || weeklyDeduction <= 0) {
        return { success: false, error: 'El descuento semanal debe ser mayor que cero.' };
    }
    // A weekly deduction above the principal would collect more than was lent on
    // the very first payment.
    if (toCentsExact(weeklyDeduction) > toCentsExact(principalAmount)) {
        return { success: false, error: 'El descuento semanal no puede ser mayor que el monto del adelanto.' };
    }
    if (!isBusinessDate(startWeekEnding)) {
        return { success: false, error: 'La semana de inicio no es una fecha válida.' };
    }

    try {
        await prisma.salaryAdvance.create({
            data: {
                cloverEmployeeId,
                employeeName,
                principalAmount: principalAmount.toFixed(2),
                weeklyDeduction: weeklyDeduction.toFixed(2),
                // Normalised to the week's Sunday so the status walk lines up
                // with a date picked anywhere inside the week.
                startWeekEnding: businessDateToUtcDate(sundayOf(startWeekEnding)),
                note: note?.trim() ? note.trim() : null,
            },
        });

        revalidatePath(PAYROLL_ROUTE);
        return { success: true };
    } catch (e) {
        return { success: false, error: `No se pudo registrar el adelanto: ${e instanceof Error ? e.message : String(e)}` };
    }
}

/**
 * Record one week's repayment against an advance.
 *
 * An amount equal to the outstanding balance is ALLOWED — that is the final
 * payment, and rejecting it would make an advance impossible to close. Only an
 * amount strictly greater is refused, because collecting more than was lent is
 * not a repayment.
 */
export async function recordDeduction(
    advanceId: string,
    weekEnding: string,
    amountCents: number,
    recordedByName?: string
): Promise<{ success: boolean; error?: string }> {
    if (!(await isAdminSession())) {
        return { success: false, error: 'No tienes permiso para registrar descuentos.' };
    }
    if (!advanceId) {
        return { success: false, error: 'Falta identificar el adelanto.' };
    }
    if (!Number.isFinite(amountCents) || Math.round(amountCents) <= 0) {
        return { success: false, error: 'El descuento debe ser mayor que cero.' };
    }
    if (!isBusinessDate(weekEnding)) {
        return { success: false, error: 'La semana no es una fecha válida.' };
    }

    const amount = Math.round(amountCents);

    try {
        const advance = await prisma.salaryAdvance.findUnique({ where: { id: advanceId } });
        if (!advance) {
            return { success: false, error: 'No se encontró el adelanto.' };
        }

        const existing = await prisma.retentionLedger.findMany({
            where: { kind: RetentionKind.DESCUENTO, advanceId },
            select: { amount: true },
        });
        const paid = existing.reduce((t, l) => t + toCentsExact(dec(l.amount)), 0);
        const outstanding = toCentsExact(dec(advance.principalAmount)) - paid;

        if (outstanding <= 0) {
            return { success: false, error: 'Este adelanto ya está pagado por completo.' };
        }
        // Strictly greater only: an exact payoff is the whole point of the last
        // payment and must go through.
        if (amount > outstanding) {
            return {
                success: false,
                error: `El descuento excede el saldo pendiente de $${(outstanding / 100).toFixed(2)}.`,
            };
        }

        // The week row is upserted rather than required to exist: a deduction
        // can be recorded for a week nobody has settled payroll for yet, and
        // failing on that would make the common case the broken one. Same upsert
        // savePayrollEntry uses, so the two share one row per week.
        const week = sundayOf(weekEnding);
        const weekRow = await prisma.payrollWeek.upsert({
            where: { weekEnding: businessDateToUtcDate(week) },
            create: { weekEnding: businessDateToUtcDate(week) },
            update: {},
            select: { id: true },
        });

        await prisma.retentionLedger.create({
            data: {
                cloverEmployeeId: advance.cloverEmployeeId,
                employeeName: advance.employeeName,
                kind: RetentionKind.DESCUENTO,
                amount: (amount / 100).toFixed(2),
                advanceId,
                payrollWeekId: weekRow.id,
                recordedByName: recordedByName?.trim() ? recordedByName.trim() : null,
            },
        });

        // Closed exactly when nothing is left, so the panel can show a paid-off
        // state without recomputing the balance to find out.
        if (amount === outstanding) {
            await prisma.salaryAdvance.update({ where: { id: advanceId }, data: { isActive: false } });
        }

        revalidatePath(PAYROLL_ROUTE);
        return { success: true };
    } catch (e) {
        return { success: false, error: `No se pudo registrar el descuento: ${e instanceof Error ? e.message : String(e)}` };
    }
}

/**
 * Remove a deduction recorded by mistake.
 *
 * Reopens the advance if removing this payment leaves a balance, because an
 * advance closed by that payment is no longer settled once it is gone.
 */
export async function deleteDeduction(ledgerId: string): Promise<{ success: boolean; error?: string }> {
    if (!(await isAdminSession())) {
        return { success: false, error: 'No tienes permiso para borrar descuentos.' };
    }
    if (!ledgerId) {
        return { success: false, error: 'Falta identificar el descuento.' };
    }

    try {
        const row = await prisma.retentionLedger.findUnique({ where: { id: ledgerId } });
        if (!row) {
            return { success: false, error: 'No se encontró el descuento.' };
        }
        if (row.kind !== RetentionKind.DESCUENTO || !row.advanceId) {
            return { success: false, error: 'Ese registro no es un descuento de adelanto.' };
        }

        const advanceId = row.advanceId;
        await prisma.retentionLedger.delete({ where: { id: ledgerId } });

        const advance = await prisma.salaryAdvance.findUnique({ where: { id: advanceId } });
        if (advance) {
            const remaining = await prisma.retentionLedger.findMany({
                where: { kind: RetentionKind.DESCUENTO, advanceId },
                select: { amount: true },
            });
            const paid = remaining.reduce((t, l) => t + toCentsExact(dec(l.amount)), 0);
            const outstanding = toCentsExact(dec(advance.principalAmount)) - paid;

            if (outstanding > 0 && !advance.isActive) {
                await prisma.salaryAdvance.update({ where: { id: advanceId }, data: { isActive: true } });
            }
        }

        revalidatePath(PAYROLL_ROUTE);
        return { success: true };
    } catch (e) {
        return { success: false, error: `No se pudo borrar el descuento: ${e instanceof Error ? e.message : String(e)}` };
    }
}

// ─────────────────────────────────────────────────────────────
// ADP Payroll Liability import
//
// Three actions, split so that nothing is written until a human has seen the
// figures: parse shows, commit stores, and the service fee arrives days later
// by hand. The parsing itself is in lib/adpLiabilityParse.ts — this file is
// 'use server', so anything exported from it is a public endpoint.
// ─────────────────────────────────────────────────────────────

export type AdpParseResponse = {
    success: boolean;
    result?: AdpLiabilityParseResult;
    error?: string;
};

/**
 * Parse an uploaded Payroll Liability .xlsx. WRITES NOTHING.
 *
 * Not gated by isAdminSession: it touches no data and returns only what the
 * caller already uploaded. commitAdpRun is where the gate belongs, and it has
 * one. Keeping the preview open means a non-admin can still be asked to check a
 * file without being handed the ability to store it.
 */
export async function parseAdpLiability(fileBase64: string): Promise<AdpParseResponse> {
    if (!fileBase64) {
        return { success: false, error: 'No se recibió ningún archivo.' };
    }

    try {
        const rows = xlsxToRows(fileBase64);
        if (rows.length === 0) {
            return { success: false, error: 'La hoja está vacía.' };
        }

        const result = parseAdpLiabilityRows(rows);

        // Without a check date there is nothing to key the run on, so this is
        // the one parse failure that cannot be shown as a warning and left to
        // the person importing.
        if (!result.checkDate) {
            return {
                success: false,
                error: 'No se encontró la línea "Check Date From" — no se puede identificar la fecha del pago.',
            };
        }

        return { success: true, result };
    } catch (e) {
        return { success: false, error: `No se pudo leer el archivo: ${e instanceof Error ? e.message : String(e)}` };
    }
}

/** Dollars to a Decimal-safe string, or null. Prisma takes the string as-is. */
const money = (value: number | null | undefined): string | null =>
    value === null || value === undefined || !Number.isFinite(value) ? null : value.toFixed(2);

const rate = (value: number | null | undefined): string | null =>
    value === null || value === undefined || !Number.isFinite(value) ? null : value.toFixed(3);

/**
 * Store a parsed run, replacing any earlier import of the same one.
 *
 * The natural key is [checkDate, payrollNumber], so re-importing a file after a
 * correction replaces the run rather than adding a second copy of it.
 *
 * The lookup is a findFirst rather than an upsert on the compound unique because
 * payrollNumber is NULLABLE. In Postgres two nulls never conflict, so a unique
 * index cannot match a run whose payroll number is absent, and an upsert would
 * quietly insert a duplicate every time such a file was imported. Matching by
 * hand costs one query and behaves the same whether the number is there or not.
 *
 * A missing figure is stored as 0 because the columns are non-nullable — but
 * only ever after the preview has shown that label as missing and a human has
 * pressed confirm anyway. That is a decision taken in front of a warning, not a
 * silent default. It is also not hypothetical: FUTA legitimately disappears once
 * an employee passes the wage base, and refusing the import would leave a real
 * run with no way in.
 *
 * serviceFee is NOT touched, on create or on update. ADP does not know it at run
 * time — the invoice arrives the Monday after — so import has nothing to say
 * about it, and a re-import must not wipe a fee somebody has already entered.
 */
export async function commitAdpRun(
    parsed: AdpLiabilityParseResult
): Promise<{ success: boolean; created?: boolean; error?: string }> {
    if (!(await isAdminSession())) {
        return { success: false, error: 'No tienes permiso para importar nóminas de ADP.' };
    }
    if (!parsed?.checkDate || !isBusinessDate(parsed.checkDate)) {
        return { success: false, error: 'La fecha del pago no es válida.' };
    }

    const checkDate = new Date(`${parsed.checkDate}T00:00:00.000Z`);
    const payrollNumber = parsed.payrollNumber ?? null;
    const a = parsed.amounts;

    // Every stored figure, with the nulls the columns cannot hold flattened to
    // 0. serviceFee is absent from this object on purpose — see above.
    const figures = {
        erSocSec: money(a.erSocSec) ?? '0.00',
        erMedicare: money(a.erMedicare) ?? '0.00',
        erFuta: money(a.erFuta) ?? '0.00',
        erSui: money(a.erSui) ?? '0.00',
        erSdi: money(a.erSdi) ?? '0.00',
        erTaxTotal: money(a.erTaxTotal) ?? '0.00',
        workersComp: money(a.workersComp) ?? '0.00',
        debitTaxes: money(a.debitTaxes) ?? '0.00',
        debitChecks: money(a.debitChecks) ?? '0.00',
        debitDirectDeposit: money(a.debitDirectDeposit) ?? '0.00',
        totalCashRequired: money(a.totalCashRequired) ?? '0.00',
        futaRate: rate(parsed.rates.futaRate),
        suiRate: rate(parsed.rates.suiRate),
        sdiRate: rate(parsed.rates.sdiRate),
    };

    try {
        const existing = await prisma.adpRun.findFirst({
            where: { checkDate, payrollNumber },
            select: { id: true },
        });

        if (existing) {
            await prisma.adpRun.update({ where: { id: existing.id }, data: figures });
        } else {
            await prisma.adpRun.create({ data: { checkDate, payrollNumber, ...figures } });
        }

        revalidatePath(PAYROLL_ROUTE);
        return { success: true, created: !existing };
    } catch (e) {
        return { success: false, error: `No se pudo guardar la nómina: ${e instanceof Error ? e.message : String(e)}` };
    }
}

/**
 * Enter (or clear) ADP's processing fee for a run.
 *
 * Separate from import because the figure arrives separately: the fee invoice
 * lands the Monday after the run and debits three days later, so it is typed in
 * by hand once it is known. Passing null puts the run back to pending, which is
 * the state to be in when a fee was entered by mistake — zero would claim the
 * run was free.
 */
export async function setAdpServiceFee(
    adpRunId: string,
    amount: number | null
): Promise<{ success: boolean; error?: string }> {
    if (!(await isAdminSession())) {
        return { success: false, error: 'No tienes permiso para cambiar la comisión de ADP.' };
    }
    if (!adpRunId) {
        return { success: false, error: 'Falta identificar la nómina.' };
    }
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
        return { success: false, error: 'La comisión debe ser un número positivo.' };
    }

    try {
        await prisma.adpRun.update({
            where: { id: adpRunId },
            data: { serviceFee: amount === null ? null : (toCentsExact(amount) / 100).toFixed(2) },
        });
        revalidatePath(PAYROLL_ROUTE);
        return { success: true };
    } catch (e) {
        return { success: false, error: `No se pudo guardar la comisión: ${e instanceof Error ? e.message : String(e)}` };
    }
}

/** One imported run, with the employer cost already worked out. */
export type AdpRunRow = {
    id: string;
    /** ISO YYYY-MM-DD, formatted by the caller. */
    checkDate: string;
    payrollNumber: string | null;
    erSocSec: number;
    erMedicare: number;
    erFuta: number;
    erSui: number;
    erSdi: number;
    erTaxTotal: number;
    workersComp: number;
    /** Null means the invoice has not arrived yet — NOT zero. */
    serviceFee: number | null;
    debitTaxes: number;
    debitChecks: number;
    debitDirectDeposit: number;
    totalCashRequired: number;
    futaRate: number | null;
    suiRate: number | null;
    sdiRate: number | null;
    /** erTaxTotal + workersComp + serviceFee, in cents. */
    employerCostCents: number;
    /** True while serviceFee is null, so the cost is shown as incomplete. */
    employerCostPending: boolean;
    importedAt: string;
};

/**
 * Days from the Sunday ending a payroll week to the Friday its checks land.
 *
 * The week runs Monday to Sunday, payroll is processed the following Thursday
 * and the checks land Friday — five days after the Sunday. This is the ONLY
 * link between a worked week and what ADP charged for it: AdpRun is run-level
 * and carries no week reference, so the date arithmetic is the join.
 */
const WEEK_END_TO_CHECK_DATE_DAYS = 5;

/** The whole payroll cost of one week, wage side and employer side together. */
export type PayrollSpend = {
    weekEnding: string;
    weekStart: string;
    /** The check date looked for: weekEnding + 5 days. Shown when no run matched. */
    expectedCheckDate: string;

    /** False when the week has NO PayrollEntry rows — see hasEntries below. */
    hasEntries: boolean;
    entryCount: number;

    // ── Wages, from the settled PayrollEntry rows ──
    adpWageCents: number;
    checkWageCents: number;

    // ── Tips. NOT spend. See the note on totalSpendCents. ──
    adpTipsCents: number;
    checkTipsCents: number;
    tipsPassthroughCents: number;

    // ── Employer cost, from the matched AdpRun ──
    adpRunMissing: boolean;
    /** How many runs shared this check date. Normally 1; 2 means an off-cycle run. */
    matchedRunCount: number;
    erTaxTotalCents: number;
    workersCompCents: number;
    /** Null while ADP's fee invoice has not arrived. Never treated as zero. */
    serviceFeeCents: number | null;

    // ── Retention: money HELD, not money spent ──
    retainedCents: number;
    deliveredCents: number;
    /** retained - delivered. Held without subtracting ENTREGA is the wrong figure. */
    totalRetainedCents: number;

    totalSpendCents: number;
    /** False when the run is missing or its fee has not been entered. */
    spendIsComplete: boolean;
};

/**
 * What one payroll week actually cost.
 *
 * ── TIPS ARE NOT SPEND, and this is the thing to get right ──
 *
 * totalSpend deliberately EXCLUDES tips, both the ADP side and the check side.
 * Tips are money customers handed over for the staff; the restaurant holds them
 * briefly and passes them on. Counting them as payroll cost would inflate the
 * figure by the entire tip pool — on the first week of real data that is over
 * $3,200 against roughly $1,000 of wages, so the error would be larger than the
 * number it corrupts. They are returned separately as tipsPassthroughCents so
 * they can be SHOWN without being ADDED.
 *
 * What IS spend: wages the restaurant paid (through ADP and by check), plus the
 * employer's own liability on top of them (taxes, workers comp, ADP's fee).
 *
 * Retention is not spend either. It is wages already counted in adpWage /
 * checkWage that are being held back rather than handed over — adding it would
 * count the same dollars twice.
 *
 * The AdpRun is matched on checkDate = weekEnding + 5 days and NOTHING ELSE. If
 * no run carries that date the wage side is returned alone with adpRunMissing
 * set: a nearby run is not evidence of anything, and quietly attaching one would
 * charge a week for a payroll it did not generate.
 */
export async function getPayrollSpend(weekEnding?: string): Promise<PayrollSpend> {
    const { start: startStr, end: endStr } = resolveWeekRange(weekEnding);
    const expectedCheckDate = addDays(endStr, WEEK_END_TO_CHECK_DATE_DAYS);

    const [weekRow, runs] = await Promise.all([
        prisma.payrollWeek.findUnique({
            where: { weekEnding: businessDateToUtcDate(endStr) },
            select: { id: true },
        }),
        // findMany, not findFirst: [checkDate, payrollNumber] is unique, so two
        // runs CAN share a check date — a regular run plus an off-cycle one. Both
        // cost the employer money, so both are counted. Taking the first would
        // silently drop the second.
        prisma.adpRun.findMany({
            where: { checkDate: businessDateToUtcDate(expectedCheckDate) },
            select: { erTaxTotal: true, workersComp: true, serviceFee: true },
        }),
    ]);

    // Decimal -> string -> cents, so no figure passes through a float on the way
    // in. Each amount is rounded exactly once, here.
    const cents = (d: Prisma.Decimal | null | undefined): number =>
        d === null || d === undefined ? 0 : toCents(d.toString());

    const [entryAgg, ledger] = await Promise.all([
        weekRow
            ? prisma.payrollEntry.aggregate({
                where: { payrollWeekId: weekRow.id },
                _count: { _all: true },
                _sum: { adpWage: true, checkWage: true, adpTips: true, checkTips: true },
            })
            : null,
        weekRow
            ? prisma.retentionLedger.groupBy({
                by: ['kind'],
                where: {
                    payrollWeekId: weekRow.id,
                    // ADELANTO and DESCUENTO are advances and their repayments,
                    // not retention. Summing all four kinds together would report
                    // a loan as money held.
                    kind: { in: [RetentionKind.RETENCION, RetentionKind.ENTREGA] },
                },
                _sum: { amount: true },
            })
            : [],
    ]);

    const entryCount = entryAgg?._count._all ?? 0;
    const hasEntries = entryCount > 0;

    const adpWageCents = cents(entryAgg?._sum.adpWage);
    const checkWageCents = cents(entryAgg?._sum.checkWage);
    const adpTipsCents = cents(entryAgg?._sum.adpTips);
    const checkTipsCents = cents(entryAgg?._sum.checkTips);

    const adpRunMissing = runs.length === 0;

    const erTaxTotalCents = runs.reduce((t, r) => t + cents(r.erTaxTotal), 0);
    const workersCompCents = runs.reduce((t, r) => t + cents(r.workersComp), 0);

    // Null when the fee is not KNOWN, which covers two different situations:
    // no run has been imported at all, or a matched run is still awaiting its
    // invoice. Without the adpRunMissing test the empty-array cases would fold
    // to 0 on their own — .some() is false and .reduce() returns the seed — and
    // an unimported run would report a fee of exactly zero rather than an
    // unknown one. That is the null-is-not-zero mistake this whole model exists
    // to avoid, committed by the code meant to enforce it.
    //
    // A part-known fee is also not a known fee: adding only the invoices that
    // happen to have arrived would report a total that looks finished but is
    // short.
    const serviceFeeCents =
        adpRunMissing || runs.some(r => r.serviceFee === null)
            ? null
            : runs.reduce((t, r) => t + cents(r.serviceFee), 0);

    const sumOf = (kind: RetentionKind): number =>
        cents(ledger.find(l => l.kind === kind)?._sum.amount ?? null);

    const retainedCents = sumOf(RetentionKind.RETENCION);
    const deliveredCents = sumOf(RetentionKind.ENTREGA);

    return {
        weekEnding: endStr,
        weekStart: startStr,
        expectedCheckDate,
        hasEntries,
        entryCount,
        adpWageCents,
        checkWageCents,
        adpTipsCents,
        checkTipsCents,
        tipsPassthroughCents: adpTipsCents + checkTipsCents,
        adpRunMissing,
        matchedRunCount: runs.length,
        erTaxTotalCents,
        workersCompCents,
        serviceFeeCents,
        retainedCents,
        deliveredCents,
        totalRetainedCents: retainedCents - deliveredCents,
        // Wages + employer liability. No tips, no retention — see above.
        totalSpendCents:
            adpWageCents + checkWageCents + erTaxTotalCents + workersCompCents + (serviceFeeCents ?? 0),
        spendIsComplete: !adpRunMissing && serviceFeeCents !== null,
    };
}

/**
 * Every imported run, newest first.
 *
 * The employer cost is computed here rather than in the component so there is
 * one definition of it. It is deliberately NOT totalCashRequired: that figure
 * includes the employees' own money — their net pay and the tax withheld from
 * them — and answers "what left the bank", not "what this cost us".
 */
export async function getAdpRuns(): Promise<AdpRunRow[]> {
    const rows = await prisma.adpRun.findMany({ orderBy: { checkDate: 'desc' } });

    return rows.map(r => {
        const serviceFee = r.serviceFee === null ? null : dec(r.serviceFee);
        const erTaxTotal = dec(r.erTaxTotal);
        const workersComp = dec(r.workersComp);

        return {
            id: r.id,
            checkDate: r.checkDate.toISOString().slice(0, 10),
            payrollNumber: r.payrollNumber,
            erSocSec: dec(r.erSocSec),
            erMedicare: dec(r.erMedicare),
            erFuta: dec(r.erFuta),
            erSui: dec(r.erSui),
            erSdi: dec(r.erSdi),
            erTaxTotal,
            workersComp,
            serviceFee,
            debitTaxes: dec(r.debitTaxes),
            debitChecks: dec(r.debitChecks),
            debitDirectDeposit: dec(r.debitDirectDeposit),
            totalCashRequired: dec(r.totalCashRequired),
            futaRate: r.futaRate === null ? null : dec(r.futaRate),
            suiRate: r.suiRate === null ? null : dec(r.suiRate),
            sdiRate: r.sdiRate === null ? null : dec(r.sdiRate),
            employerCostCents:
                toCentsExact(erTaxTotal) + toCentsExact(workersComp) + (serviceFee === null ? 0 : toCentsExact(serviceFee)),
            employerCostPending: serviceFee === null,
            importedAt: r.importedAt.toISOString(),
        };
    });
}
