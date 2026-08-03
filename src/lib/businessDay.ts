/**
 * Business-day helpers for the kitchen's operational calendar.
 *
 * The restaurant operates on New York time and the crew regularly works past
 * midnight, so "the day" is NOT the civil calendar day: activity before
 * BUSINESS_DAY_CUTOVER_HOUR (NY wall clock) belongs to the PREVIOUS
 * operational day.
 *
 * All timezone math goes through Intl.DateTimeFormat with
 * timeZone 'America/New_York' — never hardcoded UTC offsets — so EST/EDT
 * transitions are handled correctly. No external dependencies.
 */

const NY_TZ = 'America/New_York';

/**
 * NY-time hour before which activity belongs to the previous operational day.
 * A completion at 12:40 AM is still "yesterday's" work; the operational day
 * rolls over at 5:00 AM New York time.
 */
export const BUSINESS_DAY_CUTOVER_HOUR = 5;

/** Wall-clock parts of a UTC instant as seen in New York. */
function nyWallParts(instant: Date): {
    year: number; month: number; day: number; hour: number; minute: number; second: number;
} {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: NY_TZ,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
    }).formatToParts(instant);
    const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
    // Intl can render midnight as hour '24' in some engines; normalize to 0.
    const rawHour = get('hour');
    return {
        year: get('year'), month: get('month'), day: get('day'),
        hour: rawHour === 24 ? 0 : rawHour, minute: get('minute'), second: get('second'),
    };
}

function pad(n: number): string {
    return String(n).padStart(2, '0');
}

function ymd(year: number, month: number, day: number): string {
    return `${year}-${pad(month)}-${pad(day)}`;
}

/** Add whole days to a 'YYYY-MM-DD' string (pure calendar math, no TZ involved). */
function addDays(dateStr: string, days: number): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + days));
    return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/**
 * Convert a New York wall-clock time to the UTC instant it occurs at.
 * Iterative Intl-based inversion (two passes converge across DST changes);
 * derives the NY offset per-date rather than assuming -05:00/-04:00.
 */
function nyWallToUtc(dateStr: string, hour: number, minute = 0): Date {
    const [y, m, d] = dateStr.split('-').map(Number);
    const desired = Date.UTC(y, m - 1, d, hour, minute, 0);
    let guess = desired; // start as if NY were UTC, then correct
    for (let i = 0; i < 2; i++) {
        const wall = nyWallParts(new Date(guess));
        const wallAsUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
        guess += desired - wallAsUtc;
    }
    return new Date(guess);
}

/**
 * The operational business date ('YYYY-MM-DD') for a given instant.
 * Formats the instant in America/New_York and, if the NY hour is before
 * BUSINESS_DAY_CUTOVER_HOUR, attributes it to the previous calendar day.
 *
 * Example: 2026-07-02T04:40Z = 12:40 AM EDT July 2 → '2026-07-01'.
 */
export function getBusinessDate(now: Date = new Date()): string {
    const wall = nyWallParts(now);
    const civil = ymd(wall.year, wall.month, wall.day);
    return wall.hour < BUSINESS_DAY_CUTOVER_HOUR ? addDays(civil, -1) : civil;
}

/**
 * The business date after the current one — "tomorrow" in operational terms.
 * At 12:40 AM EDT July 2 (still business day July 1), this is '2026-07-02'.
 */
export function getNextBusinessDate(now: Date = new Date()): string {
    return addDays(getBusinessDate(now), 1);
}

/**
 * UTC instants spanning the given NY calendar day: [midnight NY, next
 * midnight NY - 1ms]. DST-correct on both edges (a window crossing a
 * transition is 23 or 25 hours long, as it should be).
 *
 * Existing Schedule rows are noon-anchored (legacy rows at 12:00-05:00 =
 * 17:00Z, new rows at NY noon), so both anchors always fall inside this
 * window for their day.
 */
export function getScheduleWindowUtc(businessDate: string): { start: Date; end: Date } {
    const start = nyWallToUtc(businessDate, 0, 0);
    const nextMidnight = nyWallToUtc(addDays(businessDate, 1), 0, 0);
    return { start, end: new Date(nextMidnight.getTime() - 1) };
}

/**
 * UTC instants spanning an *operational* day: [cutover NY on the business
 * date, cutover NY the next day - 1ms]. With the cutover at 5 AM this is
 * 05:00:00.000 through 04:59:59.999 the following morning.
 *
 * This is the window to use against an external system that timestamps
 * activity as it happens — a POS, say — because it is the same day boundary
 * getBusinessDate() applies. getScheduleWindowUtc is NOT interchangeable with
 * it: that one is midnight-to-midnight, and late-night activity would land in
 * the wrong day. Both derive from BUSINESS_DAY_CUTOVER_HOUR rather than from a
 * second calendar, and DST is handled by nyWallToUtc on each edge.
 */
export function getBusinessDayWindowUtc(businessDate: string): { start: Date; end: Date } {
    const start = nyWallToUtc(businessDate, BUSINESS_DAY_CUTOVER_HOUR, 0);
    const nextCutover = nyWallToUtc(addDays(businessDate, 1), BUSINESS_DAY_CUTOVER_HOUR, 0);
    return { start, end: new Date(nextCutover.getTime() - 1) };
}

/**
 * Noon New York time on the given date, as a UTC Date. Used as the canonical
 * Schedule.date anchor — noon is safely inside the day's window regardless of
 * DST, matching the existing noon-anchor convention.
 */
export function getScheduleAnchorUtc(businessDate: string): Date {
    return nyWallToUtc(businessDate, 12, 0);
}

/**
 * Day of week (0=Sunday … 6=Saturday) of a 'YYYY-MM-DD' business date.
 * Pure calendar computation — independent of server timezone.
 */
export function getBusinessDayOfWeek(businessDate: string): number {
    const [y, m, d] = businessDate.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

/**
 * The same business day as getBusinessDate(), expressed as a Date rather than a
 * 'YYYY-MM-DD' string. Same BUSINESS_DAY_CUTOVER_HOUR, same NY timezone math —
 * this is only a representation change, not a second calendar. Do not introduce
 * another cutover for it.
 *
 * Pinned to 00:00:00.000Z so it stores cleanly in a Prisma @db.Date column.
 */
export function getBusinessDateAsDate(now: Date = new Date()): Date {
    const [y, m, d] = getBusinessDate(now).split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Spanish long form of a business date, e.g. 'domingo, 2 de agosto de 2026'.
 *
 * timeZone is 'UTC' on purpose: the stored value is already a plain calendar
 * date pinned to UTC midnight, so formatting it in NY would shift it back a day.
 */
export function formatBusinessDateEs(d: Date): string {
    return new Intl.DateTimeFormat('es', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
    }).format(d);
}
