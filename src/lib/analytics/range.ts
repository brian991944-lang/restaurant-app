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

/** The presets the shell offers. 'all' is every day since Toast started. */
export type RangePreset = '7d' | '30d' | 'all';

export const RANGE_PRESETS: readonly RangePreset[] = ['7d', '30d', 'all'];

/** What a dashboard opens on when the URL names no window. */
export const DEFAULT_RANGE_PRESET: RangePreset = '30d';

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

/**
 * The window a preset names, ending today. '7d' is today and the six days
 * before it; a preset that reaches back past Toast's first day stops there.
 */
export function presetRange(preset: RangePreset, today: string): DateRange {
    const to = later(today, TOAST_FIRST_BUSINESS_DATE);
    const from = preset === 'all' ? TOAST_FIRST_BUSINESS_DATE : shiftDate(to, -(preset === '7d' ? 7 : 30) + 1);
    return { from: later(from, TOAST_FIRST_BUSINESS_DATE), to };
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
 * The same-length window that ends the day before this one starts — what
 * "vs. the previous period" compares against. Null when that window would
 * begin before Toast's first day: a comparison against a partial period
 * would read as a drop that never happened.
 */
export function previousRange(range: DateRange): DateRange | null {
    const days = daysBetween(range.from, range.to);
    if (days === 0) return null;
    const to = shiftDate(range.from, -1);
    const from = shiftDate(to, -days + 1);
    return from < TOAST_FIRST_BUSINESS_DATE ? null : { from, to };
}

/** Which preset button a window corresponds to, if any, so the shell can light it. */
export function matchPreset(range: DateRange, today: string): RangePreset | null {
    for (const preset of RANGE_PRESETS) {
        const r = presetRange(preset, today);
        if (r.from === range.from && r.to === range.to) return preset;
    }
    return null;
}
