/**
 * ADP fee invoice parser.
 *
 * Same split as lib/adpLiabilityParse.ts and for the same reason: this module is
 * PURE — no Prisma, no network, no environment read, no knowledge of the file
 * format it came from. It takes `string[][]` and nothing else. lib/adpSheet.ts
 * turns an .xlsx into that shape, and a CSV front-end would produce the same.
 *
 * ── What this document is, and what it is NOT ──
 *
 * The fee invoice is what ADP charges the RESTAURANT for its services. It is a
 * different document from the Payroll Liability report, arrives days later, and
 * debits on a different day. Two charges matter:
 *
 *   "ADP Essential Payroll"              — the processing charge for the run.
 *   "Pay-by-Pay Workers' Compensation"   — the flat fee to ADMINISTER the comp
 *                                          policy. NOT the premium.
 *
 * The premium lives in the Liability report as workersComp and goes to the
 * insurance carrier. This is ADP's handling fee. Both are small, both plausible,
 * so adding one to the other produces a wrong number that looks right.
 *
 * ── Layout ──
 *
 * Unlike the Liability report, this is a FLAT TABLE: a header row and one row
 * per charge. Columns are addressed positionally because that is what a table
 * gives you; the Item Description is still matched by label, so a reordered
 * charge list cannot silently map a fee to the wrong kind.
 *
 * One invoice can cover more than one period — invoice 725724890 carries both
 * 06/28 and 07/05 — so rows are grouped by Period-Ending Date and never by
 * invoice. Assuming one invoice is one week would merge two weeks' fees into
 * whichever period happened to be read last.
 */

/** Zero-based column indices, from the invoice's own column numbering. */
const COL = {
    /** Subtotal rows announce themselves here with "Total Invoice#…". */
    totalMarker: 5,
    itemDescription: 7,
    /** MM/DD/YYYY, a Sunday, equal to PayrollWeek.weekEnding. */
    periodEnding: 8,
    unitCount: 9,
    /** The charge after discount — what is actually owed. */
    totalDue: 19,
} as const;

/** Which charge a row is. Anything else is ignored and counted. */
export type AdpFeeKind = 'PAYROLL' | 'WORKERS_COMP';

/**
 * Item Description text, matched after normalisation. Kept as a table so a new
 * charge type is a line here rather than another branch in the loop.
 *
 * Matched by PREFIX, not equality: ADP appends plan qualifiers to these
 * descriptions and an exact match would silently stop recognising a charge the
 * first time they did.
 */
const ITEM_PREFIXES: { prefix: string; kind: AdpFeeKind }[] = [
    { prefix: 'adp essential payroll', kind: 'PAYROLL' },
    { prefix: "pay-by-pay workers' compensation", kind: 'WORKERS_COMP' },
    { prefix: 'pay-by-pay workers compensation', kind: 'WORKERS_COMP' },
];

/** Rows ADP includes that are not charges against a period. */
const MISC_PREFIX = 'miscellaneous item';
const TOTAL_PREFIX = 'total invoice#';

/**
 * The table's own header, which sits in the description column like any other
 * value. Skipped by name rather than by row number: the header is on row 4
 * today, and keying on that would break the moment ADP adds a line above it.
 *
 * Without this the header reports itself as an unrecognised charge — harmless
 * to the figures, but it puts a permanent false warning in front of the user,
 * and a warning that is always there is one nobody reads.
 */
const HEADER_DESCRIPTION = 'item description';

export type AdpFeePeriod = {
    /** ISO YYYY-MM-DD. The payroll week's Sunday, as the invoice states it. */
    periodEnding: string;
    /** Dollars, rounded to cents. Null when the invoice carried no such line. */
    payrollFee: number | null;
    workersCompFee: number | null;
    /** Unit Count from the PAYROLL line — how many people that run paid. */
    employees: number | null;
    /** Integer cents, for arithmetic that must not drift. */
    payrollFeeCents: number | null;
    workersCompFeeCents: number | null;
};

export type AdpFeeUnreadable = {
    /** 1-based row in the source sheet, so a problem can be traced back to it. */
    row: number;
    description: string;
    reason: 'SIN_FECHA' | 'IMPORTE_ILEGIBLE';
    raw: string;
};

export type AdpFeeParseResult = {
    periods: AdpFeePeriod[];
    /** Distinct invoice numbers seen, for display. One file can hold several. */
    invoiceNumbers: string[];
    /** "Miscellaneous Item" rows skipped — reported, never silently dropped. */
    miscSkipped: number;
    /** "Total Invoice#" subtotal rows skipped. */
    totalRowsSkipped: number;
    /** Charge rows whose description matched nothing known. */
    unrecognisedDescriptions: string[];
    /** Rows that looked like charges but could not be read. */
    unreadable: AdpFeeUnreadable[];
    /** Periods carrying more than one row of the same kind — summed, and flagged. */
    duplicatedKinds: { periodEnding: string; kind: AdpFeeKind; rows: number }[];
};

// ─────────────────────────────────────────────────────────────
// Cell helpers — same rules as the Liability parser
// ─────────────────────────────────────────────────────────────

const norm = (v: string): string => v.replace(/\s+/g, ' ').trim().toLowerCase();

const cellAt = (row: string[], i: number): string => {
    const v = row[i];
    return v === undefined || v === null ? '' : String(v);
};

/**
 * Read a money cell, or null when it holds no number.
 *
 * Accepts `$`, thousands separators and parenthesised negatives — a credit on a
 * fee invoice is written `(16.00)`. Returns null, never 0, for anything else.
 */
function readNumber(raw: string): number | null {
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    const negated = /^\(.*\)$/.test(trimmed) ? `-${trimmed.slice(1, -1)}` : trimmed;
    const cleaned = negated.replace(/[$,\s]/g, '');
    if (cleaned === '' || cleaned === '-') return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
}

/** Round half away from zero, as the Liability parser does. ADP ships float noise. */
function toCentsRounded(value: number): number {
    const scaled = value * 100;
    return scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
}

/**
 * MM/DD/YYYY → ISO YYYY-MM-DD.
 *
 * Also accepts what Excel does to a date cell when SheetJS reads it raw: a
 * serial number, or an ISO timestamp. Returns null rather than guessing.
 */
function readPeriodEnding(raw: string): string | null {
    const s = raw.trim();
    if (s === '') return null;

    const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
    if (mdy) {
        const [, m, d, y] = mdy;
        return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }

    const isoish = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (isoish) return `${isoish[1]}-${isoish[2]}-${isoish[3]}`;

    // Excel serial: days since 1899-12-30, which is the epoch Excel actually
    // uses once its 1900 leap-year bug is accounted for.
    const serial = Number(s);
    if (Number.isFinite(serial) && serial > 20000 && serial < 80000) {
        const ms = Math.round(serial) * 86400000;
        const base = Date.UTC(1899, 11, 30);
        return new Date(base + ms).toISOString().slice(0, 10);
    }

    return null;
}

// ─────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────

/**
 * Parse an ADP fee invoice from rows of cells.
 *
 * Pure: same rows in, same result out, no clock and no I/O.
 *
 * Every row is classified rather than filtered, so nothing disappears without
 * being counted. A row is one of: a subtotal, a miscellaneous item, a known
 * charge, an unrecognised charge, or an unreadable one — and the last three are
 * all reported.
 */
export function parseAdpFeeRows(rows: string[][]): AdpFeeParseResult {
    const byPeriod = new Map<string, {
        payrollCents: number | null;
        workersCompCents: number | null;
        employees: number | null;
        payrollRows: number;
        workersCompRows: number;
    }>();

    const invoiceNumbers = new Set<string>();
    const unrecognised = new Set<string>();
    const unreadable: AdpFeeUnreadable[] = [];
    let miscSkipped = 0;
    let totalRowsSkipped = 0;

    rows.forEach((row, index) => {
        const marker = norm(cellAt(row, COL.totalMarker));

        // Subtotal rows. Counted rather than ignored: a file with none at all
        // would mean the layout moved, and silence would be the only symptom.
        if (marker.startsWith(TOTAL_PREFIX)) {
            totalRowsSkipped++;
            const num = /total invoice#\s*(\S+)/.exec(marker);
            if (num) invoiceNumbers.add(num[1]);
            return;
        }

        const description = cellAt(row, COL.itemDescription).trim();
        const d = norm(description);
        if (d === '' || d === HEADER_DESCRIPTION) return;   // blank, spacer and header rows

        if (d.startsWith(MISC_PREFIX)) {
            miscSkipped++;
            return;
        }

        const match = ITEM_PREFIXES.find(p => d.startsWith(p.prefix));
        if (!match) {
            unrecognised.add(description);
            return;
        }

        const periodEnding = readPeriodEnding(cellAt(row, COL.periodEnding));
        if (!periodEnding) {
            // A charge with no period cannot be attached to a run. Reported, and
            // deliberately NOT guessed onto a neighbouring period.
            unreadable.push({
                row: index + 1,
                description,
                reason: 'SIN_FECHA',
                raw: cellAt(row, COL.periodEnding),
            });
            return;
        }

        const amount = readNumber(cellAt(row, COL.totalDue));
        if (amount === null) {
            unreadable.push({
                row: index + 1,
                description,
                reason: 'IMPORTE_ILEGIBLE',
                raw: cellAt(row, COL.totalDue),
            });
            return;
        }

        const entry = byPeriod.get(periodEnding) ?? {
            payrollCents: null,
            workersCompCents: null,
            employees: null,
            payrollRows: 0,
            workersCompRows: 0,
        };

        const cents = toCentsRounded(amount);

        if (match.kind === 'PAYROLL') {
            // Summed rather than overwritten. A period legitimately carrying two
            // payroll lines — a run plus an adjustment — owes both, and taking
            // the last would quietly discard one.
            entry.payrollCents = (entry.payrollCents ?? 0) + cents;
            entry.payrollRows++;
            const units = readNumber(cellAt(row, COL.unitCount));
            if (units !== null) {
                entry.employees = Math.max(entry.employees ?? 0, Math.round(units));
            }
        } else {
            entry.workersCompCents = (entry.workersCompCents ?? 0) + cents;
            entry.workersCompRows++;
        }

        byPeriod.set(periodEnding, entry);
    });

    const duplicatedKinds: AdpFeeParseResult['duplicatedKinds'] = [];
    const periods: AdpFeePeriod[] = [...byPeriod.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([periodEnding, e]) => {
            if (e.payrollRows > 1) duplicatedKinds.push({ periodEnding, kind: 'PAYROLL', rows: e.payrollRows });
            if (e.workersCompRows > 1) duplicatedKinds.push({ periodEnding, kind: 'WORKERS_COMP', rows: e.workersCompRows });
            return {
                periodEnding,
                payrollFee: e.payrollCents === null ? null : e.payrollCents / 100,
                workersCompFee: e.workersCompCents === null ? null : e.workersCompCents / 100,
                employees: e.employees,
                payrollFeeCents: e.payrollCents,
                workersCompFeeCents: e.workersCompCents,
            };
        });

    return {
        periods,
        invoiceNumbers: [...invoiceNumbers].sort(),
        miscSkipped,
        totalRowsSkipped,
        unrecognisedDescriptions: [...unrecognised].sort(),
        unreadable,
        duplicatedKinds,
    };
}
