/**
 * Toast's business day: rolls over at 4:00 AM restaurant time (New York).
 * The app's own day rolls at 5 AM (src/lib/businessDay.ts); Toast lines are
 * dated by Toast's rule so a re-run always files a line under the same day
 * Toast does.
 */

export const TOAST_CUTOVER_HOUR = 4;
const TZ = 'America/New_York';

/** The first business day rung on Toast. Nothing before it exists in Toast. */
export const TOAST_FIRST_BUSINESS_DATE = '2026-09-30';

/** 'YYYY-MM-DD' Toast business date for an instant. */
export function toastBusinessDateOf(instant: Date): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false
    }).formatToParts(instant);
    const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
    const hour = Number(get('hour')) % 24;
    const civil = `${get('year')}-${get('month')}-${get('day')}`;
    return hour < TOAST_CUTOVER_HOUR ? shiftDate(civil, -1) : civil;
}

/** 'YYYY-MM-DD' plus n days, pure calendar math. */
export function shiftDate(date: string, days: number): string {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + days, 12)).toISOString().slice(0, 10);
}

/** The last n Toast business dates ending today, oldest first. */
export function lastToastBusinessDates(n: number, now: Date = new Date()): string[] {
    const today = toastBusinessDateOf(now);
    return Array.from({ length: n }, (_, i) => shiftDate(today, i - (n - 1)));
}

/** Every Toast business date from `first` through today, oldest first; empty if `first` is after today. */
export function toastBusinessDatesSince(first: string, now: Date = new Date()): string[] {
    const today = toastBusinessDateOf(now);
    const dates: string[] = [];
    for (let d = first; d <= today; d = shiftDate(d, 1)) dates.push(d);
    return dates;
}

/** Toast's businessDate number/string (yyyymmdd) to 'YYYY-MM-DD'. */
export function fromToastBusinessDate(value: unknown): string | null {
    const s = String(value ?? '');
    return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null;
}

/** A 'YYYY-MM-DD' as the Date a @db.Date column takes. */
export function dateColumn(date: string): Date {
    return new Date(`${date}T00:00:00.000Z`);
}
