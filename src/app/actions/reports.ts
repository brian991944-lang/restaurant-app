'use server';

import prisma from '@/lib/prisma';
import { ImportKind } from '@prisma/client';
import { getBusinessDate, businessDateToUtcDate } from '@/lib/businessDay';
import { addDays, sundayOf } from '@/lib/payrollWeek';

/**
 * Whether a week's file is in.
 *
 *   PRESENT — the data is there.
 *   MISSING — it should be there by now and is not. This is a gap.
 *   PENDING — it cannot exist yet, so its absence means nothing.
 *
 * PENDING exists because a week nobody has finished working is not a week
 * somebody forgot to upload, and neither is a week whose ADP check date has not
 * arrived. Colouring either of those as a gap would train the reader to ignore
 * the colour, which is the one thing a gap indicator must not do.
 */
export type UploadState = 'PRESENT' | 'MISSING' | 'PENDING';

export type UploadSlot = {
    state: UploadState;
    /** ISO instant of the most recent upload, or null when never uploaded. */
    lastAt: string | null;
    fileName: string | null;
    /** How many uploads are known for this week. >1 means it was re-uploaded. */
    uploadCount: number;
};

export type UploadWeekRow = {
    weekStart: string;
    weekEnding: string;
    /** weekEnding + 5 days — the Friday the checks land. */
    expectedCheckDate: string;
    /** True for the week containing today, which is still being worked. */
    isCurrentWeek: boolean;
    timesheet: UploadSlot;
    adp: UploadSlot;
    /** True when either side is MISSING. Never true for PENDING alone. */
    hasGap: boolean;
};

/** Days from the Sunday ending a week to the Friday its checks land. */
const WEEK_END_TO_CHECK_DATE_DAYS = 5;

const iso = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * The file name buried in an importBatchId.
 *
 * TimesheetImporter builds the id as `${file.name}-${Date.now()}`, so for every
 * upload that predates ImportLog the name is still recoverable from the punches
 * themselves. Without this the three imports already in the database would show
 * as nameless, which reads as missing information rather than as history that
 * was never recorded.
 *
 * Anchored on a trailing run of at least ten digits so a file whose own name
 * ends in `-2026` is not truncated.
 */
function fileNameFromBatchId(batchId: string | null): string | null {
    if (!batchId) return null;
    const stripped = batchId.replace(/-\d{10,}$/, '');
    return stripped.trim() === '' ? null : stripped;
}

/**
 * One row per week: what was uploaded, when, and what is missing.
 *
 * ── Presence comes from the DATA, provenance from the LOG ──
 *
 * Whether a week is imported is answered by the PayrollPunch rows and the
 * AdpRun, never by ImportLog. The log postdates the first imports, so a presence
 * check against it would report weeks holding real punches as empty — wrong on
 * the day it shipped, and wrong in the direction that makes someone re-upload a
 * file that was already in.
 *
 * The log supplies what the data cannot: the file name, the exact upload time,
 * and how many times a period was uploaded. Where it has nothing to say — every
 * import before it existed — the punches answer as best they can, through their
 * createdAt and the name embedded in importBatchId.
 *
 * The window starts at the earliest week holding ANY punch or ADP data. Earlier
 * weeks predate the importers entirely and would show as gaps for something
 * nobody was ever asked to upload.
 */
export async function getUploadLog(): Promise<UploadWeekRow[]> {
    const today = getBusinessDate();
    const currentWeekEnding = sundayOf(today);

    const [punchBounds, runBounds] = await Promise.all([
        prisma.payrollPunch.aggregate({ _min: { businessDate: true } }),
        prisma.adpRun.aggregate({ _min: { checkDate: true } }),
    ]);

    const earliestFromPunches = punchBounds._min.businessDate
        ? sundayOf(iso(punchBounds._min.businessDate))
        : null;
    // A run's week is its check date less the five days, so the earliest run
    // anchors a week even if no punch was ever imported for it.
    const earliestFromRuns = runBounds._min.checkDate
        ? addDays(iso(runBounds._min.checkDate), -WEEK_END_TO_CHECK_DATE_DAYS)
        : null;

    const candidates = [earliestFromPunches, earliestFromRuns].filter((d): d is string => d !== null);
    if (candidates.length === 0) return [];

    const firstWeekEnding = candidates.sort()[0];
    const windowStart = addDays(firstWeekEnding, -6);

    const [punches, runs, logs] = await Promise.all([
        prisma.payrollPunch.findMany({
            where: { businessDate: { gte: businessDateToUtcDate(windowStart) } },
            select: { businessDate: true, importBatchId: true, createdAt: true },
        }),
        prisma.adpRun.findMany({
            where: { checkDate: { gte: businessDateToUtcDate(windowStart) } },
            select: { checkDate: true, importedAt: true, updatedAt: true },
        }),
        prisma.importLog.findMany({ orderBy: { importedAt: 'desc' } }),
    ]);

    // Punches indexed by the week they belong to, so each week is one lookup
    // rather than a scan.
    type PunchWeek = { batchIds: Set<string>; latestCreatedAt: Date; latestBatchId: string | null };
    const punchesByWeek = new Map<string, PunchWeek>();
    for (const p of punches) {
        const key = sundayOf(iso(p.businessDate));
        const found = punchesByWeek.get(key);
        if (!found) {
            punchesByWeek.set(key, {
                batchIds: new Set(p.importBatchId ? [p.importBatchId] : []),
                latestCreatedAt: p.createdAt,
                latestBatchId: p.importBatchId,
            });
            continue;
        }
        if (p.importBatchId) found.batchIds.add(p.importBatchId);
        if (p.createdAt > found.latestCreatedAt) {
            found.latestCreatedAt = p.createdAt;
            found.latestBatchId = p.importBatchId;
        }
    }

    const runsByCheckDate = new Map(runs.map(r => [iso(r.checkDate), r]));

    const timesheetLogs = logs.filter(l => l.kind === ImportKind.TIMESHEET);
    const adpLogs = logs.filter(l => l.kind === ImportKind.ADP_LIABILITY);

    const rows: UploadWeekRow[] = [];
    for (let weekEnding = firstWeekEnding; weekEnding <= currentWeekEnding; weekEnding = addDays(weekEnding, 7)) {
        const weekStart = addDays(weekEnding, -6);
        const expectedCheckDate = addDays(weekEnding, WEEK_END_TO_CHECK_DATE_DAYS);
        const isCurrentWeek = weekEnding === currentWeekEnding;

        // ── Timesheet ──
        const pw = punchesByWeek.get(weekEnding);
        // A log entry belongs to this week when its period OVERLAPS the week.
        // A single upload can span two weeks — a shift clocking in after
        // midnight lands on the business date before it — so containment would
        // drop the very entries the boundary makes interesting.
        const tLogs = timesheetLogs.filter(
            l => l.periodStart && l.periodEnd &&
                iso(l.periodStart) <= weekEnding && iso(l.periodEnd) >= weekStart
        );

        const tLatestLog = tLogs[0] ?? null;   // logs are already newest-first
        const tPresent = pw !== undefined;
        const tLastAt = [
            tLatestLog?.importedAt ?? null,
            pw?.latestCreatedAt ?? null,
        ].filter((d): d is Date => d !== null).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

        const timesheet: UploadSlot = {
            state: tPresent ? 'PRESENT' : isCurrentWeek ? 'PENDING' : 'MISSING',
            lastAt: tLastAt ? tLastAt.toISOString() : null,
            fileName: tLatestLog?.fileName ?? fileNameFromBatchId(pw?.latestBatchId ?? null),
            // The larger of the two counts. Re-importing DELETES the superseded
            // punches, so surviving batch ids cannot count uploads on their own —
            // they only prove that at least one happened.
            uploadCount: Math.max(pw?.batchIds.size ?? 0, tLogs.length),
        };

        // ── ADP ──
        const run = runsByCheckDate.get(expectedCheckDate) ?? null;
        const aLogs = adpLogs.filter(l => l.periodStart && iso(l.periodStart) === expectedCheckDate);
        const aLatestLog = aLogs[0] ?? null;

        // A run that cannot have happened yet is not missing. The check date is
        // the deadline, not the week's end.
        const adpNotDueYet = expectedCheckDate > today;

        // commitAdpRun UPDATES an existing run rather than inserting a second
        // one, so a re-import leaves updatedAt ahead of importedAt. That is the
        // only evidence of a replacement done before the log existed.
        const runWasReplaced = run !== null && run.updatedAt.getTime() > run.importedAt.getTime();

        const adp: UploadSlot = {
            state: run ? 'PRESENT' : adpNotDueYet ? 'PENDING' : 'MISSING',
            lastAt: (aLatestLog?.importedAt ?? run?.importedAt ?? null)?.toISOString() ?? null,
            fileName: aLatestLog?.fileName ?? null,
            uploadCount: Math.max(aLogs.length, run ? (runWasReplaced ? 2 : 1) : 0),
        };

        rows.push({
            weekStart,
            weekEnding,
            expectedCheckDate,
            isCurrentWeek,
            timesheet,
            adp,
            hasGap: timesheet.state === 'MISSING' || adp.state === 'MISSING',
        });
    }

    // Newest first.
    return rows.reverse();
}
