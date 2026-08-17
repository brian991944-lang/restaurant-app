/**
 * The .xlsx front-end for every ADP workbook this app reads.
 *
 * This is the ONLY file that knows an ADP document arrives as a spreadsheet.
 * Both parsers — lib/adpLiabilityParse.ts and lib/adpFeeParse.ts — take
 * `string[][]` and nothing else, so swapping containers means adding a sibling
 * of this file (a CSV path would be one Papa.parse call producing the same
 * shape) and changing nothing else.
 *
 * Deliberately knows nothing about either document's layout. It was named
 * adpLiabilitySheet.ts while the Liability report was the only caller, which
 * read as though it were specific to it; it never was.
 *
 * SheetJS is installed from the vendor's own CDN tarball rather than from npm.
 * The npm `xlsx` package is frozen at 0.18.5 and carries two unfixed advisories
 * in its PARSING paths (CVE-2023-30533 prototype pollution, CVE-2024-22363
 * ReDoS). This feature parses a file uploaded by a browser, which is precisely
 * the exposure those describe, so the maintained 0.20.x line is the one to be
 * on. If a reinstall ever silently resolves `xlsx` to 0.18.5 from the registry,
 * that is a regression, not a version bump.
 */

import * as XLSX from 'xlsx';

/**
 * Decode an .xlsx into rows of cells.
 *
 * `raw: true` is deliberate. With raw: false SheetJS returns each cell's
 * FORMATTED text, which is whatever display format the sheet happens to carry —
 * a cell formatted to zero decimals would hand back "809" for 808.80 and the
 * figure would be wrong with nothing to show for it. Raw values keep full
 * precision, floating-point noise and all, and the parser rounds to cents on
 * read. Their noise stops there; it never reaches a stored figure.
 *
 * Every cell is stringified because the parser's contract is `string[][]`. That
 * is what keeps it container-agnostic: a CSV front-end has only strings to give
 * it, so the xlsx path hands over strings too rather than letting the two
 * front-ends disagree about what a cell is.
 */
/**
 * Widen a sheet's declared range to cover every cell it actually contains.
 *
 * ADP's fee invoice declares `!ref = A1:AF6` while holding 1,542 cells across 74
 * rows. sheet_to_json honours the declared range, so the file read back as SIX
 * rows: the header plus the first two charges. The parser then reported one
 * period, no subtotals and no invoice numbers — all of which were true of the
 * six rows it was given, and none of which were true of the file.
 *
 * A wrong `<dimension>` is common in machine-generated workbooks; Excel itself
 * ignores the element and rebuilds the range from the cells. This does the same.
 *
 * Only ever WIDENS. A declared range larger than the cells present is left
 * alone, so a sheet with deliberate trailing space keeps it.
 *
 * Exported for the check in scripts/check-adp-fee-parser.js. A corrupt
 * dimension cannot be forged by writing one — XLSX.write honours `!ref` and
 * simply omits the out-of-range cells, producing a file that genuinely lacks
 * them rather than one that merely under-declares them. The only way to
 * reproduce ADP's file is to set the bad range on a sheet that already holds
 * every cell, which is what this function is handed.
 */
export function widenRefToActualCells(sheet: XLSX.WorkSheet): void {
    const addresses = Object.keys(sheet).filter(key => /^[A-Z]+[1-9]\d*$/.test(key));
    if (addresses.length === 0) return;

    let maxRow = 0;
    let maxCol = 0;
    for (const address of addresses) {
        const { r, c } = XLSX.utils.decode_cell(address);
        if (r > maxRow) maxRow = r;
        if (c > maxCol) maxCol = c;
    }

    const declared = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null;
    const end = {
        r: Math.max(maxRow, declared?.e.r ?? 0),
        c: Math.max(maxCol, declared?.e.c ?? 0),
    };

    // Anchored at A1 rather than at the declared start: these reports begin at
    // the top left, and a declared start below row 1 would drop the header.
    sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: end });
}

export function xlsxToRows(base64: string): string[][] {
    const workbook = XLSX.read(base64, { type: 'base64' });

    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error('El archivo no tiene ninguna hoja.');

    const sheet = workbook.Sheets[sheetName];
    if (!sheet) throw new Error('No se pudo leer la hoja del archivo.');

    // Before reading, not after: sheet_to_json cannot return rows the range
    // excludes, so a truncated range is silently lossy rather than an error.
    widenRefToActualCells(sheet);

    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        raw: true,
        defval: '',
        blankrows: true,
    });

    return rows.map(row =>
        (Array.isArray(row) ? row : []).map(cell =>
            cell === null || cell === undefined ? '' : String(cell)
        )
    );
}
