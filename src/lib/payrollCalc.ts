/**
 * Payroll money arithmetic — the ADP/check split, and advance repayment status.
 *
 * This lives in lib rather than in an action file because 'use server' turns
 * every export into a callable endpoint and cannot export a sync function at
 * all. Same reasoning as lib/clover.ts, lib/timesheetParse.ts and
 * lib/payrollWeek.ts.
 *
 * PURE: no Prisma import, no 'use server', no network, no environment read.
 *
 * Every figure is INTEGER CENTS. Money is never held as a float here — a wage
 * is hours x rate, and 55.62 * 18 is not exactly 1001.16 in binary floating
 * point. Each figure is rounded to whole cents exactly ONCE, from its own
 * inputs; nothing is derived by rounding an already-rounded number a second
 * time, because those errors accumulate down a column of people.
 */

import { addDays, sundayOf } from '@/lib/payrollWeek';

// ─────────────────────────────────────────────────────────────
// The ADP / check split
// ─────────────────────────────────────────────────────────────

export type PaySplitInput = {
    hours: number;
    hourlyRate: number;
    /** Hours reported to ADP. Null means all hours worked. */
    adpHours?: number | null;
    /** Rate reported to ADP. Null means hourlyRate. */
    adpRate?: number | null;
};

export type PaySplit = {
    totalEarnedCents: number;
    adpTotalCents: number;
    checkTotalCents: number;
    /** The hours actually used for the ADP portion, after clamping. */
    effectiveAdpHours: number;
    /** The rate actually used for the ADP portion, after defaulting. */
    effectiveAdpRate: number;
};

/** Money to whole cents, rounded half away from zero. */
function toCents(amount: number): number {
    if (!Number.isFinite(amount)) return 0;
    const scaled = amount * 100;
    return scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
}

/**
 * Split a week's earnings into the ADP portion and what the check covers.
 *
 * adpHours is clamped to hours worked: a configured 40 against a 35-hour week
 * would otherwise report more hours to ADP than the person worked, and produce
 * a negative check to balance it.
 *
 * checkTotalCents is floored at zero for the same reason — when the ADP portion
 * already covers everything earned there is nothing left for the check, and a
 * negative there would read as the worker owing money.
 */
export function calcPaySplit({ hours, hourlyRate, adpHours, adpRate }: PaySplitInput): PaySplit {
    const safeHours = Number.isFinite(hours) && hours > 0 ? hours : 0;
    const safeRate = Number.isFinite(hourlyRate) && hourlyRate > 0 ? hourlyRate : 0;

    const effectiveAdpHours = Math.min(
        adpHours === null || adpHours === undefined || !Number.isFinite(adpHours) ? safeHours : adpHours,
        safeHours
    );
    const effectiveAdpRate =
        adpRate === null || adpRate === undefined || !Number.isFinite(adpRate) ? safeRate : adpRate;

    // Each rounded once, from its own operands.
    const totalEarnedCents = toCents(safeHours * safeRate);
    const adpTotalCents = toCents(effectiveAdpHours * effectiveAdpRate);

    // Integer subtraction of two already-exact cent figures — no rounding here.
    const checkTotalCents = Math.max(0, totalEarnedCents - adpTotalCents);

    return { totalEarnedCents, adpTotalCents, checkTotalCents, effectiveAdpHours, effectiveAdpRate };
}

// ─────────────────────────────────────────────────────────────
// Salary advance repayment
// ─────────────────────────────────────────────────────────────

export type AdvanceDeduction = {
    /** Any date inside the payroll week; normalised to that week's Sunday. */
    weekEnding: string;
    amountCents: number;
};

export type AdvanceStatusInput = {
    principalCents: number;
    weeklyDeductionCents: number;
    /** The week the money was handed over. Repayment starts the week AFTER. */
    startWeekEnding: string;
    deductions: AdvanceDeduction[];
    /** Last payroll week to consider when looking for gaps. */
    throughWeekEnding: string;
};

export type AdvanceStatus = {
    paidCents: number;
    outstandingCents: number;
    /**
     * Whole weeks still to run at the configured deduction.
     * Null when it cannot be determined — a non-positive weekly deduction never
     * pays anything down, and reporting 0 there would read as "finished".
     */
    weeksRemaining: number | null;
    isPaidOff: boolean;
    /**
     * Payroll weeks where a payment was genuinely owed and none was recorded.
     *
     * The walk STOPS once the balance reaches zero, so a settled advance reports
     * no missed weeks rather than one more every Sunday forever. Without that,
     * an advance repaid months ago would be the loudest thing on the screen
     * permanently and bury the real signal: somebody forgot to deduct.
     */
    missedWeeks: string[];
};

/** A runaway input must not spin forever; ten years of weeks is far past any advance. */
const MAX_WEEKS_WALKED = 520;

/**
 * Where an advance stands: how much has come back, what is left, and which
 * weeks were skipped.
 *
 * The walk starts the week AFTER startWeekEnding. That week is when the money
 * was handed over — expecting a deduction in it would report every advance as
 * missing its first payment.
 *
 * Week identity goes through sundayOf on both sides, so a deduction recorded
 * against any day of a week still matches that week.
 */
export function advanceStatus({
    principalCents,
    weeklyDeductionCents,
    startWeekEnding,
    deductions,
    throughWeekEnding,
}: AdvanceStatusInput): AdvanceStatus {
    const paidCents = deductions.reduce(
        (t, d) => t + (Number.isFinite(d.amountCents) ? Math.round(d.amountCents) : 0),
        0
    );
    const outstandingCents = Math.max(0, Math.round(principalCents) - paidCents);

    // Deductions summed per week. A week can hold more than one — a correction
    // recorded alongside the regular payment is still that week's repayment.
    const byWeek = new Map<string, number>();
    for (const d of deductions) {
        const w = sundayOf(d.weekEnding);
        const amt = Number.isFinite(d.amountCents) ? Math.round(d.amountCents) : 0;
        byWeek.set(w, (byWeek.get(w) ?? 0) + amt);
    }

    const startWeek = sundayOf(startWeekEnding);
    const lastWeek = sundayOf(throughWeekEnding);

    // Anything repaid in or before the hand-over week already reduces what is
    // owed, even though that week is never itself expected to carry a payment.
    let balance = Math.round(principalCents);
    for (const [w, amt] of byWeek) {
        if (w <= startWeek) balance -= amt;
    }

    const missedWeeks: string[] = [];
    let week = addDays(startWeek, 7);
    for (let i = 0; week <= lastWeek && i < MAX_WEEKS_WALKED; i++) {
        // Nothing is owed once the balance is cleared, so no later week can be
        // "missed". This is what stops a settled advance accruing false alarms.
        if (balance <= 0) break;

        const amt = byWeek.get(week) ?? 0;
        if (amt === 0) missedWeeks.push(week);
        balance -= amt;

        week = addDays(week, 7);
    }

    const weeksRemaining =
        outstandingCents === 0 ? 0
            : weeklyDeductionCents > 0 ? Math.ceil(outstandingCents / weeklyDeductionCents)
                : null;

    return {
        paidCents,
        outstandingCents,
        weeksRemaining,
        isPaidOff: outstandingCents === 0,
        missedWeeks,
    };
}
