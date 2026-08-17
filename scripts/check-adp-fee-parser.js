/**
 * Runnable check for the ADP fee invoice parser.  `node scripts/check-adp-fee-parser.js`
 *
 * ── Why this file exists ──
 *
 * The fee parser shipped reading every column one position to the left, and its
 * unit test passed anyway — because the test placed its cells using the same
 * one-based numbers the parser was wrongly using as indices. The test and the
 * bug agreed with each other, so the first real invoice found nothing at all.
 *
 * This fixture is built the other way round. Cells are placed by their ONE-BASED
 * spreadsheet column, converted to array positions by the same N-1 rule a real
 * reader performs, then round-tripped through an actual .xlsx via SheetJS and
 * read back the way the app reads it. The indices under test are therefore the
 * ones the app genuinely sees, and a fixture that agrees with a broken parser is
 * no longer expressible.
 *
 * There is no test runner in this project, so this is a plain script: it
 * compiles the parser to a temp directory and runs against the output. It exits
 * non-zero on failure, so CI can call it as-is.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'adpfee-'));

// The compiler is invoked through node against its own entry script rather than
// through `npx`: spawning npx.cmd on Windows without a shell fails with EINVAL,
// and running it WITH a shell would mean quoting paths correctly on two
// platforms. process.execPath is already the node running this file.
execFileSync(
    process.execPath,
    [
        path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
        'src/lib/adpFeeParse.ts',
        '--outDir', OUT,
        '--target', 'es2020',
        '--module', 'commonjs',
        '--skipLibCheck',
    ],
    { cwd: ROOT, stdio: 'inherit' }
);

const XLSX = require(path.join(ROOT, 'node_modules', 'xlsx'));
const { parseAdpFeeRows } = require(path.join(OUT, 'adpFeeParse.js'));

/** Place values by ONE-BASED spreadsheet column, exactly as the invoice numbers them. */
function sheetRow(cells) {
    const max = Math.max(...Object.keys(cells).map(Number));
    const arr = new Array(max).fill('');
    for (const [col1, value] of Object.entries(cells)) arr[Number(col1) - 1] = value;
    return arr;
}

// The apostrophe here is CURLY (U+2019), as Excel writes it. The parser's own
// table uses a straight one; normalisation is what makes them meet.
const PAYROLL = 'ADP Essential Payroll';
const COMP = 'Pay-by-Pay Workers’ Compensation';

const charge = (desc, period, units, due) => sheetRow({ 7: desc, 8: period, 9: units, 19: due });
const totalRow = inv => sheetRow({ 5: `Total Invoice# ${inv}` });

const rows = [
    sheetRow({ 1: 'ADP, Inc.' }),
    sheetRow({ 1: 'Invoice Detail' }),
    [],
    sheetRow({ 5: 'Invoice', 7: 'Item Description', 8: 'Period-Ending Date', 9: 'Unit Count', 19: 'Total Due Invoice' }),
    charge(PAYROLL, '06/28/2026', '5', '41.66'),
    charge(COMP, '06/28/2026', '', '16.00'),
    charge('Miscellaneous Item - Courier', '06/28/2026', '1', '3.50'),
    charge(PAYROLL, '07/05/2026', '10', '56.99'),
    charge(COMP, '07/05/2026', '', '16.00'),
    totalRow('725724890'),          // ONE invoice covering TWO periods
    charge(PAYROLL, '02/15/2026', '7', '48.20'),
    charge(COMP, '02/15/2026', '', '16.00'),
    totalRow('725100001'),
];

const ws = XLSX.utils.aoa_to_sheet(rows);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'Invoice');
const b64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });

const readBack = XLSX.utils
    .sheet_to_json(XLSX.read(b64, { type: 'base64' }).Sheets['Invoice'], {
        header: 1, raw: true, defval: '', blankrows: true,
    })
    .map(r => (Array.isArray(r) ? r : []).map(c => (c === null || c === undefined ? '' : String(c))));

const res = parseAdpFeeRows(readBack);

let bad = 0;
const expect = (label, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) bad++;
    console.log(`  ${label.padEnd(36)} ${JSON.stringify(got)}${ok ? '  OK' : '  WANT ' + JSON.stringify(want)}`);
};

console.log(`\ncolumns from: ${res.columnsFrom}   indices: ${JSON.stringify(res.columns)}`);
console.log(`invoices    : ${res.invoiceNumbers.join(', ')}`);
console.log(`periods     : ${res.periods.length}`);
for (const p of res.periods) console.log('  ', JSON.stringify(p));
console.log('');

expect('columns discovered from header', res.columnsFrom, 'HEADER');
expect('itemDescription index (col 7)', res.columns.itemDescription, 6);
expect('periodEnding index (col 8)', res.columns.periodEnding, 7);
expect('unitCount index (col 9)', res.columns.unitCount, 8);
expect('totalDue index (col 19)', res.columns.totalDue, 18);

expect('period count', res.periods.length, 3);
expect('periods in order', res.periods.map(p => p.periodEnding), ['2026-02-15', '2026-06-28', '2026-07-05']);

const by = Object.fromEntries(res.periods.map(p => [p.periodEnding, p]));
expect('06/28 payroll fee', by['2026-06-28'].payrollFee, 41.66);
expect('06/28 headcount', by['2026-06-28'].employees, 5);
expect('06/28 comp admin fee', by['2026-06-28'].workersCompFee, 16);
expect('07/05 payroll fee', by['2026-07-05'].payrollFee, 56.99);
expect('07/05 headcount', by['2026-07-05'].employees, 10);
expect('07/05 comp admin fee', by['2026-07-05'].workersCompFee, 16);
expect('02/15 payroll fee', by['2026-02-15'].payrollFee, 48.2);
expect('02/15 headcount', by['2026-02-15'].employees, 7);

expect('curly apostrophe matched', res.periods.every(p => p.workersCompFee === 16), true);
expect('misc rows skipped', res.miscSkipped, 1);
expect('subtotal rows skipped', res.totalRowsSkipped, 2);
expect('nothing unrecognised', res.unrecognisedDescriptions, []);
expect('nothing unreadable', res.unreadable, []);

// Without a header the documented positions must still be right.
const noHeader = parseAdpFeeRows(readBack.filter(r => !r.includes('Item Description')));
expect('no-header falls back to defaults', noHeader.columnsFrom, 'DEFAULT');
expect('no-header still finds periods', noHeader.periods.length, 3);

// The regression guard: an invoice with an extra column inserted at the front
// must still parse, because the header — not a hardcoded number — locates them.
const shifted = readBack.map(r => ['', ...r]);
const shiftedRes = parseAdpFeeRows(shifted);
expect('extra leading column tolerated', shiftedRes.periods.length, 3);
expect('shifted indices moved with header', shiftedRes.columns.itemDescription, 7);

fs.rmSync(OUT, { recursive: true, force: true });

console.log(bad === 0 ? '\nALL CHECKS PASSED' : `\n${bad} FAILED`);
process.exit(bad === 0 ? 0 : 1);
