/**
 * The date window an Analytics dashboard shows, in Toast business dates
 * ('YYYY-MM-DD', 4 AM cutover — src/lib/pos/toastBusinessDate.ts).
 *
 * Pure calendar math, no directive: the server page resolves the window from
 * the URL with it, the client shell moves it with the preset buttons, and the
 * action validates what it is asked for with the same functions.
 *
 * Every window is clamped to [TOAST_FIRST_BUSINESS_DATE, today]: nothing
 * exists in Toast before the first day, and a future day has no sales.
 */

import { TOAST_FIRST_BUSINESS_DATE, shiftDate } from '@/lib/pos/toastBusinessDate';

export type DateRange = { from: string; to: string };

/**
 * The presets the shell offers: today, yesterday, the current week (Monday
 * to today) and the current month (the 1st to today), plus custom dates.
 * Calendar-aligned on purpose — the owner runs the restaurant day by day,
 * week by week and month by month, and a rolling "last 7 days" window kept
 * mixing two weeks.
 */
export type RangePreset = 'today' | 'yesterday' | 'week' | 'month';

export const RANGE_PRESETS: readonly RangePreset[] = ['today', 'yesterday', 'week', 'month'];

/** What a dashboard opens on when the URL names no window. */
export const DEFAULT_RANGE_PRESET: RangePreset = 'week';

/** One read must stay small enough for a 60 s function and a phone. */
export const MAX_RANGE_DAYS = 366;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A real 'YYYY-MM-DD' calendar date (2026-02-30 is not one). */
export function isBusinessDate(s: unknown): s is string {
    if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
    return shiftDate(s, 0) === s;
}

/** Inclusive day count of a window; 0 when `to` is before `from`. */
export function daysBetween(from: string, to: string): number {
    const ms = Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`);
    return ms < 0 ? 0 : Math.round(ms / 86_400_000) + 1;
}

/** Every date of a window, oldest first; empty when `to` is before `from`. */
export function datesBetween(from: string, to: string): string[] {
    const dates: string[] = [];
    for (let d = from; d <= to; d = shiftDate(d, 1)) dates.push(d);
    return dates;
}

const later = (a: string, b: string) => (a > b ? a : b);
const earlier = (a: string, b: string) => (a < b ? a : b);

/** The Monday on or before a date (weeks run Monday to Sunday). */
export function mondayOf(date: string): string {
    const dow = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sunday
    return shiftDate(date, -((dow + 6) % 7));
}

/** The first day of a date's month. */
export const firstOfMonth = (date: string): string => `${date.slice(0, 7)}-01`;

/** The window a preset names; one that reaches back past Toast's first day stops there. */
export function presetRange(preset: RangePreset, today: string): DateRange {
    const t = later(today, TOAST_FIRST_BUSINESS_DATE);
    let from: string, to: string;
    switch (preset) {
        case 'today': from = to = t; break;
        case 'yesterday': from = to = shiftDate(t, -1); break;
        case 'week': from = mondayOf(t); to = t; break;
        case 'month': from = firstOfMonth(t); to = t; break;
    }
    return { from: later(from, TOAST_FIRST_BUSINESS_DATE), to: later(to, TOAST_FIRST_BUSINESS_DATE) };
}

/**
 * A window as the URL or a form gave it, clamped to what exists. Null when
 * either end is not a date, the window is inside out, or it is longer than
 * MAX_RANGE_DAYS — the caller falls back to the default preset or refuses,
 * it never guesses.
 */
export function clampRange(from: unknown, to: unknown, today: string): DateRange | null {
    if (!isBusinessDate(from) || !isBusinessDate(to)) return null;
    const range = { from: later(from, TOAST_FIRST_BUSINESS_DATE), to: earlier(to, later(today, TOAST_FIRST_BUSINESS_DATE)) };
    if (range.from > range.to) return null;
    if (daysBetween(range.from, range.to) > MAX_RANGE_DAYS) return null;
    return range;
}

/** The URL's window if it names a valid one, else the default preset. */
export function resolveRange(rawFrom: string | string[] | undefined, rawTo: string | string[] | undefined, today: string): DateRange {
    const from = Array.isArray(rawFrom) ? rawFrom[0] : rawFrom;
    const to = Array.isArray(rawTo) ? rawTo[0] : rawTo;
    return clampRange(from, to, today) ?? presetRange(DEFAULT_RANGE_PRESET, today);
}

/**
 * The window "vs. the previous period" compares against, like for like: a
 * day against the same weekday a week earlier (a Saturday against a Friday
 * says nothing); this week so far against the same weekdays of last week;
 * this month so far against the same days of last month; any other window
 * against the same-length window that ends the day before it starts.
 * Ignores Toast's first day — see previousRange for the clamped version.
 */
export function previousRangeRaw(range: DateRange, today: string): DateRange {
    const preset = matchPreset(range, today);
    if (preset === 'today' || preset === 'yesterday' || preset === 'week') return { from: shiftDate(range.from, -7), to: shiftDate(range.to, -7) };
    if (preset === 'month') {
        const [y, m] = range.from.split('-').map(Number);
        const prevFirst = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}-01`;
        const lastOfPrev = shiftDate(range.from, -1);
        // The same day of the month, or the previous month's last day when it is shorter.
        const to = earlier(`${prevFirst.slice(0, 7)}-${range.to.slice(8, 10)}`, lastOfPrev);
        return { from: prevFirst, to: isBusinessDate(to) ? to : lastOfPrev };
    }
    const days = daysBetween(range.from, range.to);
    const to = shiftDate(range.from, -1);
    return { from: shiftDate(to, -Math.max(days, 1) + 1), to };
}

/**
 * previousRangeRaw, or null when the previous window would begin before
 * Toast's first day: a comparison against a partial period would read as a
 * drop that never happened. Sales dashboards use this; Google history
 * reaches back years and uses the raw window.
 */
export function previousRange(range: DateRange, today: string): DateRange | null {
    const prev = previousRangeRaw(range, today);
    return prev.from < TOAST_FIRST_BUSINESS_DATE ? null : prev;
}

/** Which preset a window corresponds to, if any, so the shell can light its button (the first match in RANGE_PRESETS order). */
export function matchPreset(range: DateRange, today: string): RangePreset | null {
    for (const preset of RANGE_PRESETS) {
        const r = presetRange(preset, today);
        if (r.from === range.from && r.to === range.to) return preset;
    }
    return null;
}
