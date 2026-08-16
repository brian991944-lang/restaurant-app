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
export function xlsxToRows(base64: string): string[][] {
    const workbook = XLSX.read(base64, { type: 'base64' });

    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new Error('El archivo no tiene ninguna hoja.');

    const sheet = workbook.Sheets[sheetName];
    if (!sheet) throw new Error('No se pudo leer la hoja del archivo.');

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
