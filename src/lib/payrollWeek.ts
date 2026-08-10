/**
 * Payroll week arithmetic — Monday-to-Sunday, the week the Homebase export uses.
 *
 * This lives in lib rather than in app/actions/payroll.ts because that file is
 * marked 'use server': everything it exports becomes a callable server action,
 * and a sync helper cannot be exported from it at all. Same reasoning as
 * lib/clover.ts and lib/timesheetParse.ts. Before this module the same four
 * lines existed in three places — the action, the page, and the table — which is
 * exactly the kind of drift that ends with two screens disagreeing about which
 * week you are looking at.
 *
 * The module is PURE: no Prisma import, no network call, no 'use server'.
 *
 * Every calculation is UTC string math. A device-local `new Date(y, m, d)`
 * resolves its weekday against the VIEWER's timezone, so the same Wednesday
 * could snap to two different Mondays for two people looking at the same
 * screen. Nothing here constructs a local date.
 */

import { getBusinessDate, getBusinessDayOfWeek } from '@/lib/businessDay';

/** Add whole days to a 'YYYY-MM-DD' string. Pure calendar math, no timezone. */
export function addDays(dateStr: string, days: number): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + days));
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Monday of the week containing `dateStr`.
 *
 * Day-of-week comes from getBusinessDayOfWeek, which is already UTC-anchored,
 * rather than from a second weekday implementation that could disagree with it.
 */
export function mondayOf(dateStr: string): string {
    const dow = getBusinessDayOfWeek(dateStr);   // 0 = Sunday
    return addDays(dateStr, -((dow + 6) % 7));
}

/** Sunday of the week containing `dateStr` — the day a payroll week is keyed by. */
export function sundayOf(dateStr: string): string {
    return addDays(mondayOf(dateStr), 6);
}

/**
 * The Sunday ending the most recent COMPLETE week.
 *
 * The week in progress is deliberately excluded: on a Sunday the day itself is
 * not over, so the answer is the Sunday before. Payroll for a week nobody has
 * finished working would be wrong every time it was opened.
 *
 * Derived from the BUSINESS date, not the calendar date — between midnight and
 * the 5 AM cutover those differ, and the calendar date would roll the week
 * forward some hours early.
 */
export function lastCompleteWeekEnding(today: string = getBusinessDate()): string {
    const dow = getBusinessDayOfWeek(today);     // 0 = Sunday
    return addDays(today, -(dow === 0 ? 7 : dow));
}

const isBusinessDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * Which week a `?week=` parameter actually addresses.
 *
 * Anything unusable falls back to the most recent complete week rather than
 * erroring: a hand-edited URL should land somewhere sensible.
 *
 * Extracted because the payroll page now needs the SAME week in two independent
 * queries — the weekly view and the configuration list, which must include
 * anyone appearing in the week being viewed. Recomputing the fallback beside
 * each caller is how the two would end up looking at different weeks, and the
 * one place that would show is a person missing from the list that is supposed
 * to explain why they are missing.
 */
export function resolveWeekRange(weekEnding?: string): { start: string; end: string } {
    const end = weekEnding && isBusinessDate(weekEnding) ? weekEnding : lastCompleteWeekEnding();
    return { start: addDays(end, -6), end };
}
