/**
 * ADP "Payroll Liability" report parser.
 *
 * This lives in lib rather than in app/actions/payroll.ts because that file is
 * marked 'use server': everything it exports becomes a callable server action,
 * so the parsing helpers could not be exported from it without publishing them
 * as endpoints. Same reasoning as lib/timesheetParse.ts and lib/clover.ts.
 *
 * The module is deliberately PURE — no Prisma import, no network call, no
 * environment read, and no knowledge of the file format it came from. It takes
 * `string[][]`, rows of cells, and nothing else. lib/adpLiabilitySheet.ts turns
 * an .xlsx into that shape; a CSV front-end would be a single Papa.parse call
 * producing the same thing. The container is not this file's problem, which is
 * what keeps a CSV path open if ADP ever offers one.
 *
 * The report is laid out as LABELLED ROWS, not a table: a label in column 1 and
 * figures in fixed columns to its right. Two real exports (8/7/2026 and
 * 8/14/2026) were compared and every label, row position and column index was
 * identical. Row positions are still never relied on — matching is on the label
 * — because a run with an extra tax line would shift every row below it, and a
 * parser keyed to row 27 would then read the wrong figure while looking like it
 * worked. Column positions ARE relied on, deliberately: on a labelled-row report
 * the column carries the meaning (rate vs employee share vs employer share), so
 * hunting for "the number in this row" would sooner or later pick the employee
 * contribution and report it as the employer's.
 *
 * NOTHING here silently defaults to zero. A label that is not found is reported
 * in `missingLabels`, and a label found with an unreadable figure is reported in
 * `unreadableValues`. Both leave the field null rather than 0, because a run
 * whose FUTA line failed to parse is not a run with no FUTA — and a zero would
 * be indistinguishable from one that genuinely was.
 */

/** Field keys, matching the AdpRun columns they are destined for. */
export type AdpFieldKey =
    | 'debitChecks'
    | 'debitDirectDeposit'
    | 'debitTaxes'
    | 'workersComp'
    | 'totalCashRequired'
    | 'erSocSec'
    | 'erMedicare'
    | 'erFuta'
    | 'erSui'
    | 'erSdi'
    | 'erTaxTotal';

export type AdpRateKey = 'futaRate' | 'suiRate' | 'sdiRate';

/**
 * Zero-based column indices. The report is described in 1-based columns, so
 * col 1 -> 0, col 3 -> 2, col 7 -> 6.
 */
const COL = {
    /** Debit rows carry their amount in col 3. */
    debitAmount: 2,
    /** Tax rows carry the assessed rate in col 3 ... */
    rate: 2,
    /** ... and the EMPLOYER contribution in col 7. Not the employee share. */
    erAmount: 6,
} as const;

type RowSpec = {
    key: AdpFieldKey;
    /** Verbatim label as ADP writes it. Matched after normalisation, never by position. */
    label: string;
    /** Column holding this row's figure. */
    column: number;
    /** Set only on the three rows that also state a rate. */
    rateKey?: AdpRateKey;
};

/**
 * Every row this parser looks for. Adding a figure means adding a line here and
 * nothing else — the scan, the missing-label reporting and the null handling are
 * all driven off this table.
 */
const ROW_SPECS: readonly RowSpec[] = [
    { key: 'debitChecks', label: 'Debit for Checks (Net Pay)', column: COL.debitAmount },
    { key: 'debitDirectDeposit', label: 'Debit for FSDD (Full Service Direct Deposit)', column: COL.debitAmount },
    { key: 'debitTaxes', label: 'Debit for Taxes', column: COL.debitAmount },
    // Pay-by-Pay is the workers comp premium. It is an employer cost but not a
    // tax, so it lands in workersComp and stays outside erTaxTotal.
    { key: 'workersComp', label: 'Debit for Pay-by-Pay', column: COL.debitAmount },
    { key: 'totalCashRequired', label: 'Total Cash Required', column: COL.debitAmount },

    { key: 'erSocSec', label: 'Social Security', column: COL.erAmount },
    { key: 'erMedicare', label: 'Medicare', column: COL.erAmount },
    { key: 'erFuta', label: 'Federal Unemployment Tax Act', column: COL.erAmount, rateKey: 'futaRate' },
    { key: 'erSui', label: 'NJ State Unemployment (Employer)', column: COL.erAmount, rateKey: 'suiRate' },
    { key: 'erSdi', label: 'NJ State Disability (Employer)', column: COL.erAmount, rateKey: 'sdiRate' },
    { key: 'erTaxTotal', label: 'Total Taxes', column: COL.erAmount },
] as const;

export const ADP_FIELD_KEYS: readonly AdpFieldKey[] = ROW_SPECS.map(s => s.key);

/** Components of each cross-check, kept next to the total they must add up to. */
const TAX_COMPONENTS: readonly AdpFieldKey[] = ['erSocSec', 'erMedicare', 'erFuta', 'erSui', 'erSdi'];
const CASH_COMPONENTS: readonly AdpFieldKey[] = ['debitTaxes', 'debitChecks', 'debitDirectDeposit', 'workersComp'];

export type AdpCrossCheckStatus = 'OK' | 'MISMATCH' | 'INCOMPLETO';

export type AdpCrossCheck = {
    status: AdpCrossCheckStatus;
    /** Sum of the components, in integer cents. */
    componentsCents: number;
    /** The total ADP itself states, in integer cents. Null when that row is missing. */
    reportedCents: number | null;
    /** components - reported, in integer cents. Null when either side is missing. */
    differenceCents: number | null;
    /** Which inputs were absent, which is why the status is INCOMPLETO. */
    missing: AdpFieldKey[];
};

export type AdpUnreadableValue = {
    key: AdpFieldKey | AdpRateKey;
    label: string;
    /** 1-based row in the source sheet, for tracing back to the file. */
    row: number;
    /** 1-based column, in the same terms the report is described in. */
    column: number;
    raw: string;
};

export type AdpDuplicateLabel = {
    label: string;
    /** 1-based rows carrying this label. The FIRST is the one used. */
    rows: number[];
};

export type AdpLiabilityParseResult = {
    /** ISO YYYY-MM-DD. A plain string, not a Date: a Date here would be read in
     *  the server's zone and could land on the previous day. */
    checkDate: string | null;
    payrollNumber: string | null;
    /** The "Check Date From" line verbatim, so a failed parse can be eyeballed. */
    headerLine: string | null;
    /** Amounts in dollars, rounded to cents. Null means not found — never 0. */
    amounts: Record<AdpFieldKey, number | null>;
    /** The same amounts in integer cents, which is what the cross-checks use. */
    amountsCents: Record<AdpFieldKey, number | null>;
    /** Assessed rates as percentages: FUTA 0.6, SUI 2.8, SDI 0.5. */
    rates: Record<AdpRateKey, number | null>;
    missingLabels: AdpFieldKey[];
    unreadableValues: AdpUnreadableValue[];
    duplicateLabels: AdpDuplicateLabel[];
    taxCheck: AdpCrossCheck;
    cashCheck: AdpCrossCheck;
};

// ─────────────────────────────────────────────────────────────
// Cell helpers
// ─────────────────────────────────────────────────────────────

/**
 * Labels are compared with case, surrounding space, internal runs of space and a
 * trailing colon all removed. ADP's own spacing varies between the label cell
 * and the report header, and none of that variation is meaningful.
 */
function normalizeLabel(value: string): string {
    return value.replace(/\s+/g, ' ').trim().replace(/[:.]+$/, '').toLowerCase();
}

/**
 * Read a numeric cell, or null if it does not hold a number.
 *
 * Accepts what ADP and Excel between them can produce: plain numbers, `$`
 * prefixes, thousands separators, a trailing `%` on rates, and parentheses for
 * negatives. Returns null — never 0 — for anything else, so an empty or
 * text cell is reported as unreadable rather than counted as nothing.
 */
function readNumber(raw: string): number | null {
    const trimmed = raw.trim();
    if (trimmed === '') return null;

    // (60.83) is how a negative is written on a report like this.
    const negated = /^\(.*\)$/.test(trimmed) ? `-${trimmed.slice(1, -1)}` : trimmed;
    const cleaned = negated.replace(/[$,%\s]/g, '');
    if (cleaned === '' || cleaned === '-') return null;

    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
}

/**
 * Round to integer cents, half away from zero.
 *
 * ADP's own file carries floating-point noise — Total Taxes arrives as
 * 808.8000000000001 and SubTotal Federal as 612.4000000000001 — so every figure
 * is rounded on the way in. Their error is not propagated into stored amounts,
 * and because both cross-checks compare integers, it cannot fail a check by a
 * fraction of a cent either.
 */
function toCentsRounded(value: number): number {
    const scaled = value * 100;
    return scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
}

/** Rates are Decimal(6,3) in the schema; 0.6 and 2.8 need no more than that. */
function roundRate(value: number): number {
    const scaled = value * 1000;
    return (scaled < 0 ? -Math.round(-scaled) : Math.round(scaled)) / 1000;
}

/** The label of a row: its first non-empty cell, so a leading blank column is harmless. */
function rowLabel(row: string[]): string {
    for (const cell of row) {
        if (cell !== undefined && cell !== null && String(cell).trim() !== '') return String(cell);
    }
    return '';
}

const cellAt = (row: string[], index: number): string => {
    const v = row[index];
    return v === undefined || v === null ? '' : String(v);
};

// ─────────────────────────────────────────────────────────────
// Header
// ─────────────────────────────────────────────────────────────

/**
 * "Check Date From: 8/7/2026 - Payroll 1" -> { '2026-08-07', '1' }.
 *
 * The whole row is joined before matching, because a header split across cells
 * by the export would otherwise match nothing while sitting in plain sight.
 */
const HEADER_RE = /check\s*date\s*from\s*:?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s*[-–]\s*payroll\s*([A-Za-z0-9_-]+))?/i;

function parseHeader(rows: string[][]): Pick<AdpLiabilityParseResult, 'checkDate' | 'payrollNumber' | 'headerLine'> {
    for (const row of rows) {
        const joined = row.filter(c => c !== undefined && c !== null && String(c).trim() !== '')
            .map(c => String(c).trim())
            .join(' ');
        if (joined === '') continue;

        const m = HEADER_RE.exec(joined);
        if (!m) continue;

        const [, month, day, year, payroll] = m;
        const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        return {
            checkDate: iso,
            payrollNumber: payroll ?? null,
            headerLine: joined,
        };
    }
    return { checkDate: null, payrollNumber: null, headerLine: null };
}

// ─────────────────────────────────────────────────────────────
// Cross-checks
// ─────────────────────────────────────────────────────────────

/**
 * Compare a set of components against the total ADP states for them.
 *
 * Reports, never corrects. A MISMATCH is a fact about the file that the person
 * importing it needs to see; silently replacing the stated total with the
 * computed one would hide exactly the problem worth knowing about.
 */
function crossCheck(
    amountsCents: Record<AdpFieldKey, number | null>,
    components: readonly AdpFieldKey[],
    total: AdpFieldKey
): AdpCrossCheck {
    const missing = components.filter(k => amountsCents[k] === null);
    const componentsCents = components.reduce((sum, k) => sum + (amountsCents[k] ?? 0), 0);
    const reportedCents = amountsCents[total];

    // The null test gates the early return directly rather than being folded
    // into `missing`, so that the comparison below is reached only with a
    // reported figure in hand.
    if (reportedCents === null || missing.length > 0) {
        return {
            status: 'INCOMPLETO',
            componentsCents,
            reportedCents,
            differenceCents: reportedCents === null ? null : componentsCents - reportedCents,
            missing: reportedCents === null ? [...missing, total] : missing,
        };
    }

    const differenceCents = componentsCents - reportedCents;
    return {
        status: differenceCents === 0 ? 'OK' : 'MISMATCH',
        componentsCents,
        reportedCents,
        differenceCents,
        missing: [],
    };
}

// ─────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────

/**
 * Parse an ADP Payroll Liability report from rows of cells.
 *
 * Pure: same rows in, same result out, no clock and no I/O.
 */
export function parseAdpLiabilityRows(rows: string[][]): AdpLiabilityParseResult {
    const amounts = {} as Record<AdpFieldKey, number | null>;
    const amountsCents = {} as Record<AdpFieldKey, number | null>;
    const rates = { futaRate: null, suiRate: null, sdiRate: null } as Record<AdpRateKey, number | null>;
    for (const spec of ROW_SPECS) {
        amounts[spec.key] = null;
        amountsCents[spec.key] = null;
    }

    const missingLabels: AdpFieldKey[] = [];
    const unreadableValues: AdpUnreadableValue[] = [];
    const duplicateLabels: AdpDuplicateLabel[] = [];

    // Index every row by its normalised label once, rather than rescanning the
    // sheet per spec. Duplicates are recorded instead of being overwritten: two
    // rows sharing a label is ambiguity worth reporting, and the first is used.
    const byLabel = new Map<string, { row: string[]; index: number }[]>();
    rows.forEach((row, index) => {
        const label = normalizeLabel(rowLabel(row));
        if (label === '') return;
        const hits = byLabel.get(label);
        if (hits) hits.push({ row, index });
        else byLabel.set(label, [{ row, index }]);
    });

    for (const spec of ROW_SPECS) {
        const hits = byLabel.get(normalizeLabel(spec.label));
        if (!hits || hits.length === 0) {
            missingLabels.push(spec.key);
            continue;
        }
        if (hits.length > 1) {
            duplicateLabels.push({ label: spec.label, rows: hits.map(h => h.index + 1) });
        }

        const { row, index } = hits[0];

        const rawAmount = cellAt(row, spec.column);
        const amount = readNumber(rawAmount);
        if (amount === null) {
            unreadableValues.push({
                key: spec.key,
                label: spec.label,
                row: index + 1,
                column: spec.column + 1,
                raw: rawAmount,
            });
        } else {
            const cents = toCentsRounded(amount);
            amountsCents[spec.key] = cents;
            amounts[spec.key] = cents / 100;
        }

        if (spec.rateKey) {
            const rawRate = cellAt(row, COL.rate);
            const rate = readNumber(rawRate);
            if (rate === null) {
                unreadableValues.push({
                    key: spec.rateKey,
                    label: spec.label,
                    row: index + 1,
                    column: COL.rate + 1,
                    raw: rawRate,
                });
            } else {
                rates[spec.rateKey] = roundRate(rate);
            }
        }
    }

    return {
        ...parseHeader(rows),
        amounts,
        amountsCents,
        rates,
        missingLabels,
        unreadableValues,
        duplicateLabels,
        taxCheck: crossCheck(amountsCents, TAX_COMPONENTS, 'erTaxTotal'),
        cashCheck: crossCheck(amountsCents, CASH_COMPONENTS, 'totalCashRequired'),
    };
}

/**
 * The employer's true cost of a run: employer taxes + workers comp premium +
 * BOTH of ADP's fees.
 *
 * Everything is in integer cents. The two fees are nullable and separate because
 * they come from the fee invoice, which arrives days after the run — and because
 * one of them (comp administration) is easily confused with the comp PREMIUM,
 * which is workersCompCents here and comes from a different document entirely.
 *
 * Either fee being null makes the cost PENDING rather than complete. A null is
 * never treated as zero: a run still awaiting its invoice is an unfinished
 * figure, not a free one.
 */
export function employerCostCents(
    erTaxTotalCents: number | null,
    workersCompCents: number | null,
    serviceFeePayrollCents: number | null,
    serviceFeeWorkersCompCents: number | null
): { cents: number; pending: boolean } {
    return {
        cents:
            (erTaxTotalCents ?? 0) + (workersCompCents ?? 0)
            + (serviceFeePayrollCents ?? 0) + (serviceFeeWorkersCompCents ?? 0),
        pending: serviceFeePayrollCents === null || serviceFeeWorkersCompCents === null,
    };
}
