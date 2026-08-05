/**
 * Homebase timesheet export parser.
 *
 * This lives in lib rather than in app/actions/punches.ts because that file is
 * marked 'use server': everything it exports becomes a callable server action,
 * so the parsing helpers could not be exported from it without publishing them
 * as endpoints. Same reasoning as lib/clover.ts.
 *
 * The module is deliberately PURE — no Prisma import, no network call, no
 * environment read. Roster resolution takes an already-fetched roster as an
 * argument rather than fetching one, so this file can be run against a fixture
 * with no credentials and no database.
 */

import Papa from 'papaparse';
import { getBusinessDate, businessDateToUtcDate } from '@/lib/businessDay';

/** Column positions in the Homebase export. */
const COL = {
    name: 0,
    clockInDate: 1,
    clockInTime: 2,
    clockOutDate: 3,
    clockOutTime: 4,
    role: 10,
    actualHours: 13,
} as const;

/** Flag thresholds. Nothing here rejects a row — it only marks it for review. */
export const MIN_PLAUSIBLE_HOURS = 0.25;
export const MAX_PLAUSIBLE_HOURS = 14;

/** Hours are reported to 2dp, so anything under half a hundredth is equal. */
const HOURS_EPSILON = 0.005;

const NY_TZ = 'America/New_York';

const MONTHS: Record<string, number> = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

/** One Clover employee, as much of it as name resolution needs. */
export type RosterEntry = { id: string; name?: string | null; nickname?: string | null };

export type PunchFlag =
    | 'SIN_SALIDA'
    | 'SALIDA_ANTES_DE_ENTRADA'
    | 'HORAS_MINIMAS'
    | 'HORAS_MAXIMAS'
    | 'SIN_ID_CLOVER';

export type ParsedPunch = {
    businessDate: Date;
    employeeName: string;
    cloverEmployeeId: string | null;
    clockIn: Date;
    clockOut: Date | null;
    hours: number;
    isFlagged: boolean;
    flagReason: string | null;
    flags: PunchFlag[];
    /** 1-based line in the source file, so a flag can be traced back to it. */
    csvLine: number;
};

export type CrossCheck = 'OK' | 'MISMATCH' | 'SIN_FILA_TOTALES';

export type EmployeeSummary = {
    employeeName: string;
    cloverEmployeeId: string | null;
    punchCount: number;
    hoursSum: number;
    /** From this employee's "Totals for" row; null when the file had none. */
    reportedTotal: number | null;
    crossCheck: CrossCheck;
};

export type SkipCategory =
    | 'merchantName' | 'payrollPeriod' | 'header'
    | 'separator' | 'blank' | 'totalsForEmployee' | 'grandTotals';

export type TimesheetParseResult = {
    merchant: string;
    /** Verbatim from line 2, e.g. "06/22/2026 To 06/28/2026". */
    payrollPeriod: string;
    periodStart: Date | null;
    periodEnd: Date | null;
    rowsTotal: number;
    skipped: Record<SkipCategory, number>;
    punches: ParsedPunch[];
    employees: EmployeeSummary[];
    flagged: ParsedPunch[];
    unresolvedNames: string[];
    totals: {
        parsedSum: number;
        reportedGrandTotal: number | null;
        crossCheck: CrossCheck;
    };
    parseErrors: string[];
    /** True when anything needs a human's eye before committing. */
    hasWarnings: boolean;
};

// ─────────────────────────────────────────────────────────────
// Timezone-explicit date and time parsing
// ─────────────────────────────────────────────────────────────

/** Wall-clock parts of a UTC instant as seen in New York. */
function nyWallParts(instant: Date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: NY_TZ,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
    }).formatToParts(instant);
    const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
    const rawHour = get('hour');
    return {
        year: get('year'), month: get('month'), day: get('day'),
        hour: rawHour === 24 ? 0 : rawHour, minute: get('minute'), second: get('second'),
    };
}

/**
 * A New York wall-clock time as the UTC instant it actually occurs at.
 *
 * Iterative Intl inversion, two passes, deriving the NY offset per-date rather
 * than assuming -05:00/-04:00, so a punch on a DST boundary lands correctly.
 * `new Date('June 23 2026 11:45am')` would be parsed in the SERVER's timezone,
 * which is why it is never used on the raw strings.
 */
function nyWallToUtc(y: number, mo: number, d: number, hour: number, minute: number): Date {
    const desired = Date.UTC(y, mo - 1, d, hour, minute, 0);
    let guess = desired;
    for (let i = 0; i < 2; i++) {
        const wall = nyWallParts(new Date(guess));
        const wallAsUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
        guess += desired - wallAsUtc;
    }
    return new Date(guess);
}

/** "June 23 2026" → calendar parts. */
function parseDateParts(raw: string): { y: number; mo: number; d: number } | null {
    const m = raw.trim().match(/^([A-Za-z]+)\s+(\d{1,2})\s+(\d{4})$/);
    if (!m) return null;
    const mo = MONTHS[m[1].toLowerCase()];
    if (!mo) return null;
    return { y: Number(m[3]), mo, d: Number(m[2]) };
}

/** "11:45am" / "12:14am" / "5:38pm" → 24h parts. */
function parseTimeParts(raw: string): { hour: number; minute: number } | null {
    const m = raw.trim().toLowerCase().match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/);
    if (!m) return null;
    let hour = Number(m[1]) % 12;      // 12am → 0
    if (m[3] === 'pm') hour += 12;     // 12pm → 12
    return { hour, minute: Number(m[2]) };
}

/** Date + time cells → a real UTC instant, or null if either is unusable. */
function toInstant(dateRaw: string, timeRaw: string): Date | null {
    const dp = parseDateParts(dateRaw);
    const tp = parseTimeParts(timeRaw);
    if (!dp || !tp) return null;
    return nyWallToUtc(dp.y, dp.mo, dp.d, tp.hour, tp.minute);
}

/** "06/22/2026" → the Date a @db.Date column stores. */
function parseSlashDate(raw: string): Date | null {
    const m = raw.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return null;
    return businessDateToUtcDate(`${m[3]}-${m[1]}-${m[2]}`);
}

// ─────────────────────────────────────────────────────────────
// Roster matching
// ─────────────────────────────────────────────────────────────

/** Case-, accent- and spacing-insensitive key for roster matching. */
export function nameKey(s: string): string {
    return s
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Index a roster by every name it is known under.
 *
 * Both `name` and `nickname` are indexed because the timesheet may carry either
 * the legal name or the POS nickname, and there is no way to tell which from
 * the export alone.
 */
export function buildRosterIndex(roster: RosterEntry[]): Map<string, string> {
    const byKey = new Map<string, string>();
    for (const emp of roster) {
        const id = String(emp?.id ?? '');
        if (!id) continue;
        for (const candidate of [emp?.name, emp?.nickname]) {
            if (typeof candidate === 'string' && candidate.trim()) {
                byKey.set(nameKey(candidate), id);
            }
        }
    }
    return byKey;
}

// ─────────────────────────────────────────────────────────────
// Parse
// ─────────────────────────────────────────────────────────────

const FLAG_TEXT: Record<PunchFlag, string> = {
    SIN_SALIDA: 'Sin salida registrada',
    SALIDA_ANTES_DE_ENTRADA: 'La salida es anterior a la entrada',
    HORAS_MINIMAS: `Menos de ${MIN_PLAUSIBLE_HOURS} h (posible marcaje por error)`,
    HORAS_MAXIMAS: `Más de ${MAX_PLAUSIBLE_HOURS} h (posible falta de salida)`,
    SIN_ID_CLOVER: 'El nombre no coincide con ningún empleado de Clover',
};

/**
 * Parse a Homebase timesheet export into the punches an import would write.
 *
 * Nothing is rejected: a row that looks wrong is flagged and still returned, so
 * the decision stays with the person doing the import.
 */
export function parseTimesheetCsv(
    csvText: string,
    rosterIndex: Map<string, string>
): TimesheetParseResult {
    const parsed = Papa.parse<string[]>(csvText, { skipEmptyLines: false });
    const rows = parsed.data;

    const merchant = (rows[0]?.[0] ?? '').trim();
    const periodRow = rows.find(r => (r?.[0] ?? '').trim() === 'Payroll Period');
    const payrollPeriod = (periodRow?.[1] ?? '').trim();

    const periodMatch = payrollPeriod.match(/^(\d{2}\/\d{2}\/\d{4})\s+To\s+(\d{2}\/\d{2}\/\d{4})$/i);
    const periodStart = periodMatch ? parseSlashDate(periodMatch[1]) : null;
    const periodEnd = periodMatch ? parseSlashDate(periodMatch[2]) : null;

    const skipped: Record<SkipCategory, number> = {
        merchantName: 0, payrollPeriod: 0, header: 0,
        separator: 0, blank: 0, totalsForEmployee: 0, grandTotals: 0,
    };

    const reportedTotals = new Map<string, number>();
    let reportedGrandTotal: number | null = null;
    const punches: ParsedPunch[] = [];
    const parseErrors: string[] = [];

    rows.forEach((row, i) => {
        const line = i + 1;
        const first = (row?.[0] ?? '').trim();

        // ── Structural rows, counted by category ──
        if (first === '') { skipped.blank++; return; }
        if (merchant && first === merchant) { skipped.merchantName++; return; }
        if (first === 'Payroll Period') { skipped.payrollPeriod++; return; }
        if (first === 'Name') { skipped.header++; return; }
        if (first === '-') { skipped.separator++; return; }

        if (first.startsWith('Totals')) {
            const hours = Number(row[COL.actualHours]);
            if (first === 'Totals') {
                // The grand total is NOT a person. Counting it as one invents a
                // phantom employee holding the sum of everybody's hours.
                skipped.grandTotals++;
                reportedGrandTotal = Number.isFinite(hours) ? hours : null;
            } else {
                skipped.totalsForEmployee++;
                const who = first.replace(/^Totals for\s*/i, '').trim();
                if (who && Number.isFinite(hours)) reportedTotals.set(who, hours);
            }
            return;
        }

        // ── Punch row ──
        const employeeName = first;
        const clockIn = toInstant(row[COL.clockInDate] ?? '', row[COL.clockInTime] ?? '');
        if (!clockIn) {
            parseErrors.push(`Línea ${line}: ${employeeName} — no se pudo leer la entrada "${row[COL.clockInDate] ?? ''} ${row[COL.clockInTime] ?? ''}"`);
            return;
        }

        // An open punch is a real state the export can contain, so an empty
        // clock-out yields null rather than being rejected or coerced to a date.
        const outTimeRaw = (row[COL.clockOutTime] ?? '').trim();
        const outDateRaw = (row[COL.clockOutDate] ?? '').trim();
        const clockOut = outTimeRaw ? toInstant(outDateRaw, outTimeRaw) : null;
        if (outTimeRaw && !clockOut) {
            parseErrors.push(`Línea ${line}: ${employeeName} — no se pudo leer la salida "${outDateRaw} ${outTimeRaw}"`);
        }

        // As reported, never recomputed. If this disagrees with
        // (clockOut - clockIn) that is worth seeing, so it is preserved as given.
        const hoursRaw = Number(row[COL.actualHours]);
        const hours = Number.isFinite(hoursRaw) ? hoursRaw : 0;

        const cloverEmployeeId = rosterIndex.get(nameKey(employeeName)) ?? null;

        // Flags accumulate: one row can be wrong in more than one way, and
        // stopping at the first reason would hide the rest.
        const flags: PunchFlag[] = [];
        if (clockOut === null) flags.push('SIN_SALIDA');
        if (clockOut && clockOut.getTime() < clockIn.getTime()) flags.push('SALIDA_ANTES_DE_ENTRADA');
        if (hours < MIN_PLAUSIBLE_HOURS) flags.push('HORAS_MINIMAS');
        if (hours > MAX_PLAUSIBLE_HOURS) flags.push('HORAS_MAXIMAS');
        if (cloverEmployeeId === null) flags.push('SIN_ID_CLOVER');

        punches.push({
            // Derived from clockIn under the 5 AM cutover, so a shift ending
            // after midnight belongs entirely to the evening it started.
            businessDate: businessDateToUtcDate(getBusinessDate(clockIn)),
            employeeName,
            cloverEmployeeId,
            clockIn,
            clockOut,
            hours,
            isFlagged: flags.length > 0,
            flagReason: flags.length ? flags.map(f => FLAG_TEXT[f]).join('; ') : null,
            flags,
            csvLine: line,
        });
    });

    // ── Per-employee rollup and cross-check ──
    const byName = new Map<string, ParsedPunch[]>();
    for (const p of punches) {
        const list = byName.get(p.employeeName) ?? [];
        list.push(p);
        byName.set(p.employeeName, list);
    }

    const employees: EmployeeSummary[] = [...byName.entries()]
        .sort((a, b) => a[0].localeCompare(b[0], 'es'))
        .map(([employeeName, list]) => {
            const hoursSum = list.reduce((t, p) => t + p.hours, 0);
            const reported = reportedTotals.has(employeeName) ? reportedTotals.get(employeeName)! : null;
            // No "Totals for" row is NOT a pass. It reports distinctly, so a
            // block the file never totalled cannot read as reconciled.
            const crossCheck: CrossCheck =
                reported === null ? 'SIN_FILA_TOTALES'
                    : Math.abs(hoursSum - reported) < HOURS_EPSILON ? 'OK'
                        : 'MISMATCH';
            return {
                employeeName,
                cloverEmployeeId: list[0].cloverEmployeeId,
                punchCount: list.length,
                hoursSum,
                reportedTotal: reported,
                crossCheck,
            };
        });

    const parsedSum = punches.reduce((t, p) => t + p.hours, 0);
    const totalsCrossCheck: CrossCheck =
        reportedGrandTotal === null ? 'SIN_FILA_TOTALES'
            : Math.abs(parsedSum - reportedGrandTotal) < HOURS_EPSILON ? 'OK'
                : 'MISMATCH';

    const flagged = punches.filter(p => p.isFlagged);
    const unresolvedNames = employees.filter(e => e.cloverEmployeeId === null).map(e => e.employeeName);

    return {
        merchant,
        payrollPeriod,
        periodStart,
        periodEnd,
        rowsTotal: rows.length,
        skipped,
        punches,
        employees,
        flagged,
        unresolvedNames,
        totals: { parsedSum, reportedGrandTotal, crossCheck: totalsCrossCheck },
        parseErrors,
        hasWarnings:
            flagged.length > 0 ||
            unresolvedNames.length > 0 ||
            parseErrors.length > 0 ||
            totalsCrossCheck !== 'OK' ||
            employees.some(e => e.crossCheck !== 'OK'),
    };
}
