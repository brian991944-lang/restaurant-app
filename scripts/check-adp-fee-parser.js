/**
 * Runnable check for the ADP fee invoice pipeline.  `npm run check:adp-fee`
 *
 * ── Why this file exists, and why it has now failed twice ──
 *
 * First failure: the parser read every column one position to the left, and the
 * test passed anyway, because it placed cells using the same one-based numbers
 * the parser was wrongly using as indices. Test and bug agreed.
 *
 * Second failure: the real invoice declares `!ref = A1:AF6` while holding 74
 * rows of cells. sheet_to_json honours that range, so the file arrived as six
 * rows and the parser reported one period. The test passed because
 * `XLSX.utils.aoa_to_sheet` writes a CORRECT range — the broken condition could
 * not occur — and because the test called the parser DIRECTLY, never going
 * through xlsxToRows, where the bug actually was.
 *
 * Both lessons are now built in:
 *
 *   1. The fixture runs through xlsxToRows, the same entry point the app uses.
 *      Testing the parser alone left the adapter — half the pipeline — untested.
 *   2. It deliberately writes a TRUNCATED `!ref`, reproducing what ADP ships, so
 *      the file-shape that broke production is a permanent case here.
 *   3. Cells are placed by ONE-BASED spreadsheet column and converted by the same
 *      N-1 rule a real reader performs, so a fixture cannot agree with an
 *      off-by-one parser.
 *
 * There is no test runner in this project, so this is a plain script. It exits
 * non-zero on failure, so CI can call it as-is.
 */

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
// Compiled INSIDE node_modules so that `require('xlsx')` from the emitted
// adpSheet.js resolves by the normal upward walk. A system temp directory has no
// node_modules above it and the import fails.
const OUT = path.join(ROOT, 'node_modules', '.cache', 'adp-fee-check');
fs.mkdirSync(OUT, { recursive: true });

// The compiler is invoked through node against its own entry script rather than
// through `npx`: spawning npx.cmd on Windows without a shell fails with EINVAL,
// and running it WITH a shell would mean quoting paths correctly on two
// platforms. process.execPath is already the node running this file.
execFileSync(
    process.execPath,
    [
        path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'),
        'src/lib/adpFeeParse.ts',
        'src/lib/adpSheet.ts',
        '--outDir', OUT,
        '--target', 'es2020',
        '--module', 'commonjs',
        '--skipLibCheck',
        '--esModuleInterop',
    ],
    { cwd: ROOT, stdio: 'inherit' }
);

const XLSX = require(path.join(ROOT, 'node_modules', 'xlsx'));
const { parseAdpFeeRows } = require(path.join(OUT, 'adpFeeParse.js'));
// The ADAPTER is under test too. The bug that reached production lived here, not
// in the parser, and a check that skipped it could not have seen it.
const { xlsxToRows, widenRefToActualCells } = require(path.join(OUT, 'adpSheet.js'));

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

// Through the real adapter, not a local copy of what it does.
const readBack = xlsxToRows(b64);
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

expect('every row reaches the parser', readBack.length, rows.length);
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

// ── The regression that reached production ──
//
// ADP's invoice declares `!ref = A1:AF6` while holding 74 rows of cells.
// sheet_to_json honours the declared range, so the file arrived six rows long
// and the parser truthfully reported one period from what it was given.
//
// This cannot be reproduced by writing a truncated file: XLSX.write honours
// `!ref` too and omits the out-of-range cells, yielding a file that genuinely
// lacks them. The condition is a sheet that HOLDS every cell and UNDER-DECLARES
// its range, so it is built exactly that way here.
{
    const bad = XLSX.utils.aoa_to_sheet(rows);
    bad['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 5, c: 31 } });   // claims 6 rows

    const before = XLSX.utils.sheet_to_json(bad, { header: 1, raw: true, defval: '', blankrows: true });
    expect('truncated !ref really does truncate', before.length, 6);

    widenRefToActualCells(bad);
    const after = XLSX.utils
        .sheet_to_json(bad, { header: 1, raw: true, defval: '', blankrows: true })
        .map(r => (Array.isArray(r) ? r : []).map(c => (c === null || c === undefined ? '' : String(c))));
    expect('widening recovers every row', after.length, rows.length);

    const recovered = parseAdpFeeRows(after);
    expect('recovered rows yield all periods', recovered.periods.length, 3);
    expect('recovered rows yield all subtotals', recovered.totalRowsSkipped, 2);
    expect('recovered rows yield invoice numbers', recovered.invoiceNumbers, ['725100001', '725724890']);

    // A range that is already correct, or wider than the cells, must be left alone.
    const wide = XLSX.utils.aoa_to_sheet(rows);
    wide['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 99, c: 31 } });
    widenRefToActualCells(wide);
    expect('a wider declared range is preserved', XLSX.utils.decode_range(wide['!ref']).e.r, 99);
}

// Real sheets can be ragged — SheetJS omits trailing empty cells when a range is
// not padded. A short row must read as empty cells, never as end-of-data.
const ragged = readBack.map(r => {
    const copy = [...r];
    while (copy.length > 0 && copy[copy.length - 1] === '') copy.pop();
    return copy;
});
const raggedRes = parseAdpFeeRows(ragged);
expect('ragged rows still parse', raggedRes.periods.length, 3);
expect('ragged subtotals still counted', raggedRes.totalRowsSkipped, 2);

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
