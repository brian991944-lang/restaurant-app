/**
 * Toast time-entry export parser (TimeEntries_YYYY_MM_DD-YYYY_MM_DD.csv).
 *
 * PURE, like lib/timesheetParse.ts beside it: no Prisma, no network, no
 * environment read. The roster arrives as an argument, so this runs against a
 * fixture with no database.
 *
 * The result has the same shape the Homebase parser returns, so the import
 * preview and commit handle both formats; `format` says which one it was.
 *
 * What differs from Homebase:
 *   - one row per punch with a full date on each side, so an overnight shift
 *     is explicit rather than inferred;
 *   - names are "Last, First" and often not what the app calls the person
 *     ("Pillo, Lili" is Lili Marquez), so matching goes through a saved
 *     mapping before falling back to the name itself;
 *   - no totals rows, so there is nothing to cross-check against;
 *   - no employee ID and no auto clock-out column, which is why DOBLE_MARCAJE
 *     exists: it is the only signal for a double tap or a 4 AM auto clock-out.
 */

import Papa from 'papaparse';
import { getBusinessDate, businessDateToUtcDate, nyWallToUtc } from '@/lib/businessDay';
import {
    nameKey,
    MIN_PLAUSIBLE_HOURS,
    MAX_PLAUSIBLE_HOURS,
    type ParsedPunch,
    type PunchFlag,
    type EmployeeSummary,
    type SkipCategory,
    type TimesheetFormat,
    type TimesheetParseResult,
} from '@/lib/timesheetParse';

/** The header columns this parser reads, by name — never by position. */
const HEADER = {
    employee: 'Employee',
    inDate: 'In Date',
    outDate: 'Out Date',
    payableHours: 'Payable Hours',
} as const;

/** How a Toast export's first line starts. */
const TOAST_HEADER_PREFIX = 'Location,Employee,Job Title,In Date';

/** A punch starting this close to the same person's last clock-out is flagged. */
const DOUBLE_TAP_MS = 60_000;

/** Toast clocks forgotten punches out at this New York wall time. */
const AUTO_CLOCK_OUT = { hour: 4, minute: 0 } as const;

const FILE_NAME_PERIOD = /TimeEntries_(\d{4})_(\d{2})_(\d{2})-(\d{4})_(\d{2})_(\d{2})/i;

// ─────────────────────────────────────────────────────────────
// Format detection
// ─────────────────────────────────────────────────────────────

/**
 * Which export this is, from its CONTENT — the file name is not trusted to say.
 * Toast opens with its column header; Homebase opens with the merchant name
 * and has a "Payroll Period" row beneath it. Anything else is null.
 */
export function detectTimesheetFormat(csvText: string): TimesheetFormat | null {
    const text = csvText.replace(/^﻿/, '');
    const firstLine = text.split(/\r?\n/, 1)[0]?.trim() ?? '';
    if (firstLine.startsWith(TOAST_HEADER_PREFIX)) return 'TOAST';
    if (/^\s*"?Payroll Period"?\s*,/m.test(text)) return 'HOMEBASE';
    return null;
}

// ─────────────────────────────────────────────────────────────
// Roster
// ─────────────────────────────────────────────────────────────

/**
 * One person the app knows, with every name they have been recorded under.
 * Built from the database (EmployeeRate plus the names earlier punches used),
 * not from Clover.
 */
export type ToastRosterPerson = {
    id: string;
    /** The name the app already stores this person's punches under. */
    displayName: string;
    names: string[];
    /** Saved mapping from an earlier import, already in "First Last" form. */
    toastName: string | null;
};

export type ToastMatch = { id: string; displayName: string; via: 'MAPPING' | 'NAME' | 'FIRST_NAME' };

/** "Pillo, Lili" → "Lili Pillo". A name without a comma is left as it is. */
export function flipToastName(raw: string): string {
    const trimmed = raw.trim();
    const comma = trimmed.indexOf(',');
    if (comma < 0) return trimmed.replace(/\s+/g, ' ');
    const last = trimmed.slice(0, comma).trim();
    const first = trimmed.slice(comma + 1).trim();
    return `${first} ${last}`.replace(/\s+/g, ' ').trim();
}

const firstToken = (name: string) => nameKey(name).split(' ')[0] ?? '';

/**
 * Resolve a flipped Toast name to a person, in order:
 *   1. the saved Toast-name mapping;
 *   2. an exact match on any name the person is known by;
 *   3. the first name alone, but only when exactly one person has it.
 * Anything ambiguous stays unresolved, so a human picks rather than a guess.
 */
export function matchToastName(name: string, roster: ToastRosterPerson[]): ToastMatch | null {
    const key = nameKey(name);
    if (!key) return null;

    const pick = (people: ToastRosterPerson[], via: ToastMatch['via']): ToastMatch | null => {
        const ids = new Set(people.map(p => p.id));
        if (ids.size !== 1) return null;
        const p = people[0];
        return { id: p.id, displayName: p.displayName, via };
    };

    const mapped = roster.filter(p => p.toastName && nameKey(p.toastName) === key);
    if (mapped.length) return pick(mapped, 'MAPPING');

    const exact = roster.filter(p => p.names.some(n => nameKey(n) === key));
    if (exact.length) return pick(exact, 'NAME');

    const first = firstToken(name);
    if (!first) return null;
    return pick(roster.filter(p => p.names.some(n => firstToken(n) === first)), 'FIRST_NAME');
}

// ─────────────────────────────────────────────────────────────
// Dates
// ─────────────────────────────────────────────────────────────

/** "10/5/26 11:40 AM" (New York wall time) → the UTC instant, or null. */
function parseToastInstant(raw: string): Date | null {
    const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!m) return null;
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const month = Number(m[1]);
    const day = Number(m[2]);
    let hour = Number(m[4]) % 12;                 // 12 AM → 0
    if (m[6].toUpperCase() === 'PM') hour += 12;  // 12 PM → 12
    const minute = Number(m[5]);
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
    const ymd = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return nyWallToUtc(ymd, hour, minute);
}

/** True when the instant reads exactly 4:00 AM on a New York clock. */
function isAutoClockOut(instant: Date): boolean {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: false,
    }).formatToParts(instant);
    const hour = Number(parts.find(p => p.type === 'hour')?.value) % 24;
    const minute = Number(parts.find(p => p.type === 'minute')?.value);
    return hour === AUTO_CLOCK_OUT.hour && minute === AUTO_CLOCK_OUT.minute;
}

/** The period the file name states, as 'YYYY-MM-DD' strings, or null. */
function periodFromFileName(fileName: string | null | undefined): { start: string; end: string } | null {
    const m = fileName?.match(FILE_NAME_PERIOD);
    if (!m) return null;
    return { start: `${m[1]}-${m[2]}-${m[3]}`, end: `${m[4]}-${m[5]}-${m[6]}` };
}

// ─────────────────────────────────────────────────────────────
// Parse
// ─────────────────────────────────────────────────────────────

/**
 * Parse a Toast time-entry export into the punches an import would write.
 *
 * Like the Homebase parser, nothing is rejected: a row that looks wrong is
 * flagged and still returned. Whether it is imported is the preview's call.
 */
export function parseToastTimeCsv(
    csvText: string,
    roster: ToastRosterPerson[],
    fileName?: string | null
): TimesheetParseResult {
    const parsed = Papa.parse<Record<string, string>>(csvText.replace(/^﻿/, ''), {
        header: true,
        skipEmptyLines: false,
        transformHeader: h => h.trim(),
    });

    const skipped: Record<SkipCategory, number> = {
        merchantName: 0, payrollPeriod: 0, header: 1,
        separator: 0, blank: 0, totalsForEmployee: 0, grandTotals: 0,
    };
    const parseErrors: string[] = [];

    const fields = parsed.meta.fields ?? [];
    const missing = Object.values(HEADER).filter(h => !fields.includes(h));
    if (missing.length) {
        parseErrors.push(`Faltan columnas en el archivo de Toast: ${missing.join(', ')}`);
    }

    // Per file name, so one person matched by several spellings resolves once.
    const matchCache = new Map<string, ToastMatch | null>();
    const resolve = (name: string) => {
        if (!matchCache.has(name)) matchCache.set(name, matchToastName(name, roster));
        return matchCache.get(name)!;
    };

    const punches: ParsedPunch[] = [];
    if (!missing.length) parsed.data.forEach((row, i) => {
        // Line 1 is the header, so data row i sits on line i + 2.
        const line = i + 2;
        const rawName = (row[HEADER.employee] ?? '').trim();
        const inRaw = (row[HEADER.inDate] ?? '').trim();
        if (!rawName && !inRaw) { skipped.blank++; return; }

        const sourceName = flipToastName(rawName);
        const clockIn = parseToastInstant(inRaw);
        if (!clockIn) {
            parseErrors.push(`Línea ${line}: ${sourceName} — no se pudo leer la entrada "${inRaw}"`);
            return;
        }

        // An empty Out Date is an open punch, a real state — null, not an error.
        const outRaw = (row[HEADER.outDate] ?? '').trim();
        const clockOut = outRaw ? parseToastInstant(outRaw) : null;
        if (outRaw && !clockOut) {
            parseErrors.push(`Línea ${line}: ${sourceName} — no se pudo leer la salida "${outRaw}"`);
        }

        // Payable Hours as reported, never recomputed from the clock times.
        const hoursRaw = Number((row[HEADER.payableHours] ?? '').trim());
        const hours = Number.isFinite(hoursRaw) ? hoursRaw : 0;

        const match = resolve(sourceName);
        const flags: PunchFlag[] = [];
        if (clockOut === null) flags.push('SIN_SALIDA');
        if (clockOut && clockOut.getTime() < clockIn.getTime()) flags.push('SALIDA_ANTES_DE_ENTRADA');
        if (hours < MIN_PLAUSIBLE_HOURS) flags.push('HORAS_MINIMAS');
        if (hours > MAX_PLAUSIBLE_HOURS) flags.push('HORAS_MAXIMAS');
        if (!match) flags.push('SIN_ID_CLOVER');

        punches.push({
            businessDate: businessDateToUtcDate(getBusinessDate(clockIn)),
            // Stored under the app's name for the person, not Toast's spelling,
            // so this week's punches sit with their earlier ones.
            employeeName: match ? match.displayName : sourceName,
            cloverEmployeeId: match ? match.id : null,
            clockIn,
            clockOut,
            hours,
            isFlagged: false,
            flagReason: null,
            flags,
            csvLine: line,
            sourceName,
        });
    });

    // ── DOBLE_MARCAJE: needs each person's punches in clock-in order ──
    const byPerson = new Map<string, ParsedPunch[]>();
    for (const p of punches) {
        const key = p.cloverEmployeeId ?? `name:${nameKey(p.sourceName ?? p.employeeName)}`;
        const list = byPerson.get(key) ?? [];
        list.push(p);
        byPerson.set(key, list);
    }
    for (const list of byPerson.values()) {
        list.sort((a, b) => a.clockIn.getTime() - b.clockIn.getTime());
        // A 0-hour punch is skipped as the "previous clock-out": it is the double
        // tap itself (already flagged HORAS_MINIMAS), and the real shift after it
        // should not read as suspicious because of it.
        let prevOut: Date | null = null;
        for (const p of list) {
            const doubleTap = prevOut !== null && Math.abs(p.clockIn.getTime() - prevOut.getTime()) <= DOUBLE_TAP_MS;
            const autoOut = p.clockOut !== null && isAutoClockOut(p.clockOut);
            if (doubleTap || autoOut) p.flags.push('DOBLE_MARCAJE');
            if (p.hours !== 0) prevOut = p.clockOut;
        }
    }
    for (const p of punches) {
        p.isFlagged = p.flags.length > 0;
        p.flagReason = p.flags.length ? p.flags.join(',') : null;
    }

    // ── Period: the file name's dates, else the dates the punches cover ──
    const named = periodFromFileName(fileName);
    const dayTimes = punches.map(p => p.businessDate.getTime());
    const periodStart = named
        ? businessDateToUtcDate(named.start)
        : dayTimes.length ? new Date(Math.min(...dayTimes)) : null;
    const periodEnd = named
        ? businessDateToUtcDate(named.end)
        : dayTimes.length ? new Date(Math.max(...dayTimes)) : null;
    const payrollPeriod = periodStart && periodEnd
        ? `${periodStart.toISOString().slice(0, 10)} – ${periodEnd.toISOString().slice(0, 10)}`
        : '';

    // ── Per-employee rollup. Toast has no totals rows, so nothing to cross-check. ──
    const byName = new Map<string, ParsedPunch[]>();
    for (const p of punches) {
        const list = byName.get(p.employeeName) ?? [];
        list.push(p);
        byName.set(p.employeeName, list);
    }
    const employees: EmployeeSummary[] = [...byName.entries()]
        .sort((a, b) => a[0].localeCompare(b[0], 'es'))
        .map(([employeeName, list]) => ({
            employeeName,
            cloverEmployeeId: list[0].cloverEmployeeId,
            punchCount: list.length,
            hoursSum: list.reduce((t, p) => t + p.hours, 0),
            reportedTotal: null,
            crossCheck: 'SIN_FILA_TOTALES' as const,
        }));

    punches.sort((a, b) => a.clockIn.getTime() - b.clockIn.getTime() || a.csvLine - b.csvLine);
    const flagged = punches.filter(p => p.isFlagged);
    const unresolvedNames = [...new Set(punches.filter(p => !p.cloverEmployeeId).map(p => p.sourceName ?? p.employeeName))];

    return {
        format: 'TOAST',
        merchant: (parsed.data[0]?.Location ?? '').trim(),
        payrollPeriod,
        periodStart,
        periodEnd,
        rowsTotal: parsed.data.length + 1,
        skipped,
        punches,
        employees,
        flagged,
        unresolvedNames,
        totals: { parsedSum: punches.reduce((t, p) => t + p.hours, 0), reportedGrandTotal: null, crossCheck: 'SIN_FILA_TOTALES' },
        parseErrors,
        hasWarnings: flagged.length > 0 || unresolvedNames.length > 0 || parseErrors.length > 0,
    };
}
