/**
 * Historical tip importer.
 *
 *   npx --yes tsx scripts/importHistoricalTips.ts            → dry run
 *   npx --yes tsx scripts/importHistoricalTips.ts --write    → writes
 *
 * Reads scripts/tips-import.csv, validates every row, and plans what would be
 * written. Without --write it prints the plan and stops, touching the database
 * for reading only. With --write it persists the plan one day per transaction,
 * skipping any business date that already holds a TipDay.
 */

import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import prisma from '@/lib/prisma';
import { getBusinessDate, businessDateToUtcDate, getScheduleWindowUtc } from '@/lib/businessDay';
import { toCents, formatMoney } from '@/lib/money';
import { cloverFetch } from '@/lib/clover';

const CSV_PATH = path.join(process.cwd(), 'scripts', 'tips-import.csv');

/** Writing is opt-in. Bare invocation plans and prints, and touches nothing. */
const WRITE = process.argv.includes('--write');

/**
 * One-time historical mapping from the names written on the old spreadsheet to
 * Clover employee ids.
 *
 * This list is closed. It exists to read one archived sheet, where people were
 * recorded by whatever name the person filling it in used. It is NOT a staff
 * roster and must not grow: the application gets its people from
 * getWaitStaff(), which reads Clover live, so anyone hired since is already
 * handled and anyone missing here worked before the sheet ended.
 *
 * The id is the identity. The sheet name is only a lookup key and is never
 * stored — see resolveCurrentNames below.
 */
const SHEET_NAME_TO_CLOVER_ID: Record<string, string> = {
    'Jostin': '71M9ZZZF5RNRW',
    'Jeremy': 'PDTSTZRFKQ0Y0',
    'Disved': 'DC2YFTE91ZTRR',
    'Alex': 'J7D5XNHGF0FQR',
    'Gaby': 'JZ0SDHC3YFJRA',
    'Josh M': 'SQT9QH6JK9BMT',
    'Roxi': 'BK04G6014R7SW',
    'Don Henry': '0C1EBGV4HSXFR',
    'Brian': 'TYTTQGHGEDFW0',
    'Luana': '2YDZHMXMXYSY8',
    'Astrid': 'P68KN1Y82NTM0'
};

/**
 * Names as Clover held them on 2026-08-02, keyed by employee id.
 *
 * A snapshot, used only when Clover cannot be reached — the live roster is
 * always preferred, because a person who has since been renamed there should
 * import under the name the app will show. It is keyed by id rather than by
 * sheet name so it stays valid even if the sheet called someone something else.
 */
const FALLBACK_NAMES: Record<string, string> = {
    '71M9ZZZF5RNRW': 'Jostin',
    'PDTSTZRFKQ0Y0': 'Jeremy Orellana',
    'DC2YFTE91ZTRR': 'Disved',
    'J7D5XNHGF0FQR': 'Alex',
    'JZ0SDHC3YFJRA': 'Gaby',
    'SQT9QH6JK9BMT': 'Josh Miranda',
    'BK04G6014R7SW': 'Julie Perez',
    '0C1EBGV4HSXFR': 'Henry',
    'TYTTQGHGEDFW0': 'Brian Yabar',
    '2YDZHMXMXYSY8': 'Luana Yabar',
    'P68KN1Y82NTM0': 'Sara'
};

const ROLE_BY_POSITION: Record<string, 'MESERO' | 'BUSSER'> = {
    'mesero': 'MESERO',
    'busser': 'BUSSER'
};

type CsvRow = {
    Date: string;
    Turno: string;
    Position: string;
    Nombre: string;
    'Credit Tips': string;
    'Service Charge': string;
    'Cash Tips': string;
};

type ParsedRow = {
    line: number;
    businessDate: string;
    orderIndex: number;
    turnoLabel: string;
    role: 'MESERO' | 'BUSSER';
    sheetName: string;
    cloverEmployeeId: string;
    creditCents: number;
    serviceCents: number;
    cashCents: number;
};

type PlannedEntry = {
    cloverEmployeeId: string;
    employeeName: string;
    sheetName: string;
    role: 'MESERO' | 'BUSSER';
    creditCents: number;
    serviceCents: number;
    cashCents: number;
};

type PlannedShift = { orderIndex: number; turnoLabel: string; entries: PlannedEntry[] };

type PlannedDay = {
    businessDate: string;
    dateValue: Date;
    submittedAt: Date;
    totalCreditCents: number;
    totalServiceCents: number;
    totalCashCents: number;
    shifts: PlannedShift[];
};

const money = (cents: number) => `${formatMoney(cents)} (${cents}c)`;

/** MM/DD/YYYY as written on the sheet, to the YYYY-MM-DD the app speaks. */
function toBusinessDate(raw: string): string | null {
    const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    const [, mm, dd, yyyy] = m;
    const month = Number(mm);
    const day = Number(dd);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${yyyy}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * 23:59 New York on the given date, as UTC.
 *
 * Derived from getScheduleWindowUtc, whose end is the last millisecond of that
 * NY calendar day, rather than by doing timezone arithmetic here — the DST
 * handling lives in one place and this must not become a second copy of it.
 */
function endOfDayNy(businessDate: string): Date {
    const lastInstant = getScheduleWindowUtc(businessDate).end; // 23:59:59.999 NY
    return new Date(lastInstant.getTime() - 59_999);            // 23:59:00.000 NY
}

/**
 * Current Clover names, keyed by employee id.
 *
 * The name stored on an entry is the one Clover holds NOW, not the one the
 * sheet used: 'Roxi' is a nickname somebody typed, and the person's record says
 * something else. Returns null when Clover is unreachable, in which case the
 * caller falls back to the snapshot above.
 */
async function resolveCurrentNames(): Promise<Map<string, string> | null> {
    try {
        const data = await cloverFetch('/employees?limit=200');
        const names = new Map<string, string>();
        for (const emp of data?.elements ?? []) {
            if (emp?.id) names.set(String(emp.id), String(emp.name || emp.nickname || ''));
        }
        return names;
    } catch (e) {
        console.log(`  Clover roster unavailable: ${e instanceof Error ? e.message : String(e)}`);
        return null;
    }
}

async function main() {
    if (!fs.existsSync(CSV_PATH)) {
        console.error(`STOPPED — no CSV at ${CSV_PATH}`);
        process.exitCode = 1;
        return;
    }

    const csv = fs.readFileSync(CSV_PATH, 'utf8');
    const parsed = Papa.parse<CsvRow>(csv, { header: true, skipEmptyLines: true });

    // A quoting or field-count problem means the columns no longer line up, and
    // every check below would then be validating the wrong values.
    if (parsed.errors.length > 0) {
        console.error(`STOPPED — the CSV did not parse cleanly (${parsed.errors.length} error(s)):`);
        for (const e of parsed.errors.slice(0, 20)) {
            console.error(`  row ${e.row ?? '?'}: [${e.type}/${e.code}] ${e.message}`);
        }
        if (parsed.errors.length > 20) console.error(`  ...and ${parsed.errors.length - 20} more`);
        process.exitCode = 1;
        return;
    }

    // ---- Validation. Everything is checked before anything is planned. ----
    const errors: string[] = [];
    const unknownNames = new Map<string, number[]>();
    const rows: ParsedRow[] = [];

    parsed.data.forEach((raw, i) => {
        const line = i + 2; // 1-based, plus the header row
        const sheetName = (raw.Nombre ?? '').trim();
        const businessDate = toBusinessDate(raw.Date ?? '');
        const turnoLabel = (raw.Turno ?? '').trim();
        const position = (raw.Position ?? '').trim().toLowerCase();

        if (!businessDate) {
            errors.push(`line ${line}: date "${raw.Date}" is not MM/DD/YYYY`);
        }

        const turnoMatch = turnoLabel.match(/^Turno\s+(\d+)$/i);
        if (!turnoMatch) {
            errors.push(`line ${line}: turno "${raw.Turno}" is not "Turno N"`);
        }

        const role = ROLE_BY_POSITION[position];
        if (!role) {
            errors.push(`line ${line}: position "${raw.Position}" is neither Mesero nor Busser`);
        }

        const cloverEmployeeId = SHEET_NAME_TO_CLOVER_ID[sheetName];
        if (!cloverEmployeeId) {
            const seen = unknownNames.get(sheetName) ?? [];
            seen.push(line);
            unknownNames.set(sheetName, seen);
        }

        if (!businessDate || !turnoMatch || !role || !cloverEmployeeId) return;

        const orderIndex = Number(turnoMatch[1]) - 1;
        if (!Number.isInteger(orderIndex) || orderIndex < 0) {
            errors.push(`line ${line}: turno "${raw.Turno}" does not give a usable order index`);
            return;
        }

        rows.push({
            line,
            businessDate,
            orderIndex,
            turnoLabel,
            role,
            sheetName,
            cloverEmployeeId,
            creditCents: toCents(raw['Credit Tips'] ?? ''),
            serviceCents: toCents(raw['Service Charge'] ?? ''),
            cashCents: toCents(raw['Cash Tips'] ?? '')
        });
    });

    if (unknownNames.size > 0) {
        console.error('STOPPED — these names are not in the historical mapping:');
        for (const [name, lines] of unknownNames) {
            console.error(`  "${name}" — ${lines.length} row(s), first at line ${lines[0]}`);
        }
        console.error('\nAdd them to SHEET_NAME_TO_CLOVER_ID or correct the sheet. Nothing was skipped silently.');
        process.exitCode = 1;
        return;
    }

    if (errors.length > 0) {
        console.error(`STOPPED — ${errors.length} row(s) failed validation:`);
        for (const e of errors.slice(0, 40)) console.error(`  ${e}`);
        if (errors.length > 40) console.error(`  ...and ${errors.length - 40} more`);
        process.exitCode = 1;
        return;
    }

    // ---- The current day belongs to the app, not to this importer. ----
    const today = getBusinessDate();
    const skipped = rows.filter(r => r.businessDate >= today);
    const kept = rows.filter(r => r.businessDate < today);

    // ---- Duplicates would collide with @@unique([tipShiftId, cloverEmployeeId]).
    const byKey = new Map<string, ParsedRow[]>();
    for (const r of kept) {
        const key = `${r.businessDate}|${r.orderIndex}|${r.cloverEmployeeId}`;
        const group = byKey.get(key) ?? [];
        group.push(r);
        byKey.set(key, group);
    }
    const duplicates = [...byKey.entries()].filter(([, group]) => group.length > 1);
    if (duplicates.length > 0) {
        console.error(`STOPPED — ${duplicates.length} duplicate (date, turno, employee) key(s):`);
        for (const [key, group] of duplicates.slice(0, 20)) {
            console.error(`  ${key} — lines ${group.map(g => g.line).join(', ')}`);
        }
        process.exitCode = 1;
        return;
    }

    // ---- Names as Clover holds them now, or the snapshot if it cannot say. ----
    const liveNames = await resolveCurrentNames();
    const nameSource = liveNames ? 'Clover (live)' : 'fallback snapshot';

    // Per id: live first, snapshot second, and nothing else. A placeholder is
    // never stored — the name is the only human-readable trace of who this row
    // belongs to, and a row reading "<UNRESOLVED:...>" in someone's tip history
    // would be worse than not importing at all.
    const filledFromFallback: string[] = [];
    const unresolvable: string[] = [];
    const resolvedNames = new Map<string, string>();
    for (const id of new Set(kept.map(r => r.cloverEmployeeId))) {
        const live = liveNames?.get(id);
        if (live) {
            resolvedNames.set(id, live);
            continue;
        }
        const snapshot = FALLBACK_NAMES[id];
        if (snapshot) {
            resolvedNames.set(id, snapshot);
            if (liveNames) filledFromFallback.push(id);
            continue;
        }
        unresolvable.push(id);
    }

    if (unresolvable.length > 0) {
        console.error('STOPPED — no name could be resolved for these Clover ids:');
        for (const id of unresolvable) {
            const sheetNames = [...new Set(kept.filter(r => r.cloverEmployeeId === id).map(r => r.sheetName))];
            console.error(`  ${id}  (sheet: ${sheetNames.join(', ')})`);
        }
        console.error('\nAdd them to FALLBACK_NAMES, or run where Clover is reachable.');
        process.exitCode = 1;
        return;
    }

    const nameFor = (id: string) => resolvedNames.get(id) as string;

    // ---- Plan ----
    const dayMap = new Map<string, PlannedDay>();
    for (const r of kept) {
        let day = dayMap.get(r.businessDate);
        if (!day) {
            day = {
                businessDate: r.businessDate,
                dateValue: businessDateToUtcDate(r.businessDate),
                submittedAt: endOfDayNy(r.businessDate),
                totalCreditCents: 0,
                totalServiceCents: 0,
                totalCashCents: 0,
                shifts: []
            };
            dayMap.set(r.businessDate, day);
        }

        let shift = day.shifts.find(s => s.orderIndex === r.orderIndex);
        if (!shift) {
            shift = { orderIndex: r.orderIndex, turnoLabel: r.turnoLabel, entries: [] };
            day.shifts.push(shift);
        }

        shift.entries.push({
            cloverEmployeeId: r.cloverEmployeeId,
            employeeName: nameFor(r.cloverEmployeeId),
            sheetName: r.sheetName,
            role: r.role,
            creditCents: r.creditCents,
            serviceCents: r.serviceCents,
            // The sheet recorded a figure, so 0 here means counted and zero —
            // not "nobody has said yet", which is what a null would mean.
            cashCents: r.cashCents
        });

        day.totalCreditCents += r.creditCents;
        day.totalServiceCents += r.serviceCents;
        day.totalCashCents += r.cashCents;
    }

    const days = [...dayMap.values()].sort((a, b) => a.businessDate.localeCompare(b.businessDate));
    for (const day of days) day.shifts.sort((a, b) => a.orderIndex - b.orderIndex);

    const shiftCount = days.reduce((n, d) => n + d.shifts.length, 0);
    const entryCount = days.reduce((n, d) => n + d.shifts.reduce((m, s) => m + s.entries.length, 0), 0);

    // ---- Which planned dates already hold a TipDay. Read only. ----
    const existing = await prisma.tipDay.findMany({
        where: { businessDate: { in: days.map(d => d.dateValue) } },
        select: { businessDate: true, status: true }
    });
    const existingDates = new Set(existing.map(e => e.businessDate.toISOString().slice(0, 10)));

    // ================= REPORT =================
    console.log('='.repeat(72));
    console.log(WRITE
        ? 'WRITE MODE — the plan below will be persisted.'
        : 'DRY RUN — historical tip import. Nothing was written.');
    console.log('='.repeat(72));

    console.log(`\nCSV                    ${CSV_PATH}`);
    console.log(`Rows parsed            ${rows.length}`);
    console.log(`Rows skipped (>= ${today})  ${skipped.length}`);
    console.log(`Rows to import         ${kept.length}`);
    console.log(`Days planned           ${days.length}`);
    console.log(`Shifts planned         ${shiftCount}`);
    console.log(`Entries planned        ${entryCount}`);

    if (days.length > 0) {
        console.log(`Date range             ${days[0].businessDate} .. ${days[days.length - 1].businessDate}`);
    }

    if (skipped.length > 0) {
        const skippedDates = [...new Set(skipped.map(s => s.businessDate))].sort();
        console.log(`\nSKIPPED by the current-day rule — ${skipped.length} row(s) on ${skippedDates.length} date(s):`);
        for (const d of skippedDates) {
            console.log(`  ${d}  ${skipped.filter(s => s.businessDate === d).length} row(s)`);
        }
        console.log('  These days are live and belong to the UI and the Clover sync.');
    } else {
        console.log('\nSKIPPED by the current-day rule — none.');
    }

    console.log(`\nNAMES — resolved from: ${nameSource}`);
    if (!liveNames) {
        console.log('  Clover could not be reached, so the 2026-08-02 snapshot was used.');
        console.log('  A name changed in Clover since then would import under the old one.');
    }
    if (filledFromFallback.length > 0) {
        console.log(`  Clover answered but had no name for ${filledFromFallback.length} id(s); the snapshot covered them: ${filledFromFallback.join(', ')}`);
    }
    const perName = new Map<string, { id: string; rows: number }>();
    for (const r of kept) {
        const seen = perName.get(r.sheetName) ?? { id: r.cloverEmployeeId, rows: 0 };
        seen.rows++;
        perName.set(r.sheetName, seen);
    }
    for (const [sheetName, info] of [...perName.entries()].sort((a, b) => b[1].rows - a[1].rows)) {
        console.log(
            `  ${sheetName.padEnd(10)} -> ${info.id.padEnd(15)} ${nameFor(info.id).padEnd(24)} ${String(info.rows).padStart(4)} row(s)`
        );
    }
    const unusedNames = Object.keys(SHEET_NAME_TO_CLOVER_ID).filter(n => !perName.has(n));
    if (unusedNames.length > 0) {
        console.log(`  (mapping entries with no rows: ${unusedNames.join(', ')})`);
    }

    const totalCredit = days.reduce((n, d) => n + d.totalCreditCents, 0);
    const totalService = days.reduce((n, d) => n + d.totalServiceCents, 0);
    const totalCash = days.reduce((n, d) => n + d.totalCashCents, 0);
    console.log('\nTOTALS ACROSS THE IMPORT');
    console.log(`  Credit tips     ${money(totalCredit)}`);
    console.log(`  Service charge  ${money(totalService)}`);
    console.log(`  Cash tips       ${money(totalCash)}`);

    console.log('\nPLANNED DATES THAT ALREADY HOLD A TipDay');
    if (existingDates.size === 0) {
        console.log('  none — every planned day is new.');
    } else {
        for (const e of existing) {
            const iso = e.businessDate.toISOString().slice(0, 10);
            console.log(`  ${iso}  status ${e.status}  <- will be left alone by the write pass, not overwritten`);
        }
    }

    console.log('\nFIRST 3 PLANNED DAYS IN FULL');
    for (const day of days.slice(0, 3)) {
        console.log(`\n  ${day.businessDate}   (${day.dateValue.toISOString()})`);
        console.log(`    status            ENVIADO`);
        console.log(`    submittedAt       ${day.submittedAt.toISOString()}   [23:59 NY]`);
        console.log(`    submittedByName   Importación histórica`);
        console.log(`    submittedByCloverId null`);
        console.log(`    clover* columns   all null — these days were never synced`);
        console.log(`    totalCreditTips   ${money(day.totalCreditCents)}`);
        console.log(`    totalServiceCharge${money(day.totalServiceCents).padStart(19)}`);
        console.log(`    totalCashTips     ${money(day.totalCashCents)}`);
        for (const shift of day.shifts) {
            console.log(`    ${shift.turnoLabel} -> orderIndex ${shift.orderIndex}, filledBy* null, ${shift.entries.length} entr${shift.entries.length === 1 ? 'y' : 'ies'}`);
            for (const entry of shift.entries) {
                console.log(
                    `      ${entry.cloverEmployeeId.padEnd(15)} ${entry.employeeName.padEnd(24)} ${entry.role.padEnd(7)}` +
                    ` credit ${formatMoney(entry.creditCents).padStart(9)}` +
                    ` service ${formatMoney(entry.serviceCents).padStart(8)}` +
                    ` cash ${formatMoney(entry.cashCents).padStart(8)}` +
                    `   [sheet: ${entry.sheetName}]`
                );
            }
        }
    }

    if (!WRITE) {
        console.log('\n' + '='.repeat(72));
        console.log('END OF DRY RUN. No database writes were issued.');
        console.log('Re-run with --write to persist this plan.');
        console.log('='.repeat(72));
        return;
    }

    // ================= WRITE =================
    console.log('\n' + '='.repeat(72));
    console.log('WRITING');
    console.log('='.repeat(72));

    // Re-read immediately before writing rather than trusting the check made
    // further up: the plan was built a while ago, and somebody may have opened
    // one of these days in the app since.
    const claimed = await prisma.tipDay.findMany({
        where: { businessDate: { in: days.map(d => d.dateValue) } },
        select: { businessDate: true }
    });
    const claimedDates = new Set(claimed.map(c => c.businessDate.toISOString().slice(0, 10)));

    let daysWritten = 0;
    let daysSkipped = 0;
    let entriesWritten = 0;
    let processed = 0;

    for (const day of days) {
        processed++;

        if (claimedDates.has(day.businessDate)) {
            daysSkipped++;
            continue;
        }

        try {
            // One transaction per day. A day is all-or-nothing, but a failure
            // on day 90 leaves the first 89 standing — re-running then skips
            // them as pre-existing and picks up where this stopped.
            await prisma.$transaction(async tx => {
                const tipDay = await tx.tipDay.create({
                    data: {
                        businessDate: day.dateValue,
                        totalCreditTips: (day.totalCreditCents / 100).toFixed(2),
                        totalServiceCharge: (day.totalServiceCents / 100).toFixed(2),
                        totalCashTips: (day.totalCashCents / 100).toFixed(2),
                        status: 'ENVIADO',
                        submittedAt: day.submittedAt,
                        submittedByName: 'Importación histórica',
                        submittedByCloverId: null
                        // Every clover* column is left null: these days predate
                        // the sync and were never reconciled against Clover.
                    },
                    select: { id: true }
                });

                for (const shift of day.shifts) {
                    const tipShift = await tx.tipShift.create({
                        data: { tipDayId: tipDay.id, orderIndex: shift.orderIndex },
                        select: { id: true }
                    });

                    for (const entry of shift.entries) {
                        await tx.tipShiftEntry.create({
                            data: {
                                tipShiftId: tipShift.id,
                                cloverEmployeeId: entry.cloverEmployeeId,
                                employeeName: entry.employeeName,
                                role: entry.role,
                                creditTips: (entry.creditCents / 100).toFixed(2),
                                serviceCharge: (entry.serviceCents / 100).toFixed(2),
                                // A real 0, never null: the sheet recorded a
                                // figure, so this is counted-and-zero.
                                cashTips: (entry.cashCents / 100).toFixed(2)
                            }
                        });
                    }
                }
            });

            daysWritten++;
            entriesWritten += day.shifts.reduce((n, s) => n + s.entries.length, 0);
        } catch (e) {
            console.error(`\nFAILED on ${day.businessDate} (day ${processed} of ${days.length}).`);
            console.error(`  ${e instanceof Error ? e.message : String(e)}`);
            console.error(`\n  Days written before the failure: ${daysWritten}`);
            console.error(`  Days skipped as pre-existing:    ${daysSkipped}`);
            console.error(`  Entries written:                 ${entriesWritten}`);
            console.error('\n  Stopped. The failed day wrote nothing; everything before it stands.');
            console.error('  Re-running skips what landed and resumes from here.');
            process.exitCode = 1;
            return;
        }

        if (processed % 25 === 0) {
            console.log(`  ${processed}/${days.length} days processed — ${daysWritten} written, ${daysSkipped} skipped, ${entriesWritten} entries`);
        }
    }

    console.log('\n' + '='.repeat(72));
    console.log('IMPORT COMPLETE');
    console.log(`  Days written                 ${daysWritten}`);
    console.log(`  Days skipped as pre-existing ${daysSkipped}`);
    console.log(`  Entries written              ${entriesWritten}`);
    console.log('='.repeat(72));
}

main()
    .catch(e => {
        console.error(e);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
