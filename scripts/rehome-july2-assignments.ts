// Pass P-C one-time repair: re-home the 15 pending assignments that the
// night crew created at ~9:58 PM EDT on July 1 2026 (intended for July 2)
// from the July 1 schedule to a proper July 2 schedule.
//
// Guarded: matches by (July 1 schedule) AND (completedAt null) AND
// (cuid-embedded creation time in 2026-07-02T01:50Z–02:05Z, the burst
// identified in Pass P-B; decode calibrated there at 0-1ms drift).
// If the match is not EXACTLY the expected 15 rows, prints the diff and
// aborts without writing. Touches ONLY scheduleId on the matched rows.
//
// Run with: npx tsx scripts/rehome-july2-assignments.ts

import { PrismaClient } from '@prisma/client';
import { getScheduleAnchorUtc, getScheduleWindowUtc } from '../src/lib/businessDay';

const prisma = new PrismaClient();

const BURST_START = Date.parse('2026-07-02T01:50:00Z');
const BURST_END = Date.parse('2026-07-02T02:05:00Z');

const EXPECTED_NAMES = [
    'Bisteck - Porcionar',
    'Chicharron - Hervir, Porcionar y Congelar',
    'Pollo Causa - Hervir, Porcionar y Congelar',
    'Croquetas de Pollo - Empanizar Croquetas',
    'Gnocchi - Preparar y Porcionar',
    'Linguini - Preparar y Porcionar',
    'Cebolla Roja - Picar Cebolla Ceviche',
    'Cebolla Roja - Picar Cebolla Lomo',
    'Zanahoria - Rallar Zanahoria Para Ensalada',
    'Choclo - Cocinar',
    'Tomate Cherry - Picar y Ponerlo en Aceite de Oliva',
    'Yuca - Cocinar, Picar y Almacenar',
    'Huancaina - Preparar',
    'Uchucuta - Preparar',
    'Camaron - Hervir para Ceviche',
];

function cuidTime(id: string): number {
    return parseInt(id.slice(1, 9), 36);
}

async function findScheduleForDay(day: string) {
    const { start, end } = getScheduleWindowUtc(day);
    return prisma.schedule.findFirst({
        where: { date: { gte: start, lte: end } },
        include: { prepAssignments: { include: { ingredient: { select: { name: true } }, completedByCooks: true } } },
    });
}

async function reportDay(label: string, day: string) {
    const s = await findScheduleForDay(day);
    if (!s) {
        console.log(`${label} ${day}: NO schedule`);
        return;
    }
    const total = s.prepAssignments.length;
    const completed = s.prepAssignments.filter(a => a.completed).length;
    console.log(`${label} ${day}: schedule ${s.id} | assignments=${total} | completed=${completed} | pending=${total - completed}`);
}

async function main() {
    console.log('=== BEFORE ===');
    await reportDay('July 1', '2026-07-01');
    await reportDay('July 2', '2026-07-02');

    const july1 = await findScheduleForDay('2026-07-01');
    if (!july1) {
        console.log('ABORT: July 1 2026 schedule not found.');
        return;
    }

    const matched = july1.prepAssignments.filter(a => {
        const t = cuidTime(a.id);
        return a.completedAt === null && t >= BURST_START && t <= BURST_END;
    });

    console.log(`\nMatched ${matched.length} rows (July 1 schedule, completedAt null, created 01:50–02:05Z Jul 2):`);
    for (const a of matched) {
        console.log(`  ${new Date(cuidTime(a.id)).toISOString()} | ${a.ingredient?.name} | completions=${a.completedByCooks.length} | id=${a.id}`);
    }

    // Hard guards: exactly 15 rows, names must match the Pass P-B list, and
    // none may carry completion records.
    const matchedNames = matched.map(a => a.ingredient?.name || '(?)').sort();
    const expectedSorted = [...EXPECTED_NAMES].sort();
    const missing = expectedSorted.filter(n => !matchedNames.includes(n));
    const unexpected = matchedNames.filter(n => !expectedSorted.includes(n));
    const withCompletions = matched.filter(a => a.completedByCooks.length > 0);

    if (matched.length !== 15 || missing.length > 0 || unexpected.length > 0 || withCompletions.length > 0) {
        console.log('\nABORT — match does not equal the expected 15 rows. No writes performed.');
        if (matched.length !== 15) console.log(`  count: got ${matched.length}, expected 15`);
        if (missing.length) console.log(`  missing expected: ${missing.join(' | ')}`);
        if (unexpected.length) console.log(`  unexpected extras: ${unexpected.join(' | ')}`);
        if (withCompletions.length) console.log(`  rows with completion records: ${withCompletions.map(a => a.id).join(', ')}`);
        process.exitCode = 1;
        return;
    }

    // Resolve or create the July 2 schedule
    let july2 = await prisma.schedule.findFirst({
        where: { date: { gte: getScheduleWindowUtc('2026-07-02').start, lte: getScheduleWindowUtc('2026-07-02').end } },
    });
    if (!july2) {
        july2 = await prisma.schedule.create({
            data: {
                date: getScheduleAnchorUtc('2026-07-02'),
                createdBy: 'NightShift',
                assignedTo: 'MorningCrew',
                notes: 'Re-homed from July 1 schedule (Pass P-C repair of 9:58 PM Jul 1 mis-file)',
            },
        });
        console.log(`\nCreated July 2 schedule ${july2.id} at ${july2.date.toISOString()}`);
    } else {
        console.log(`\nJuly 2 schedule already exists: ${july2.id}`);
    }

    const result = await prisma.prepAssignment.updateMany({
        where: { id: { in: matched.map(a => a.id) } },
        data: { scheduleId: july2.id },
    });
    console.log(`Re-homed ${result.count} assignments to July 2 schedule (only scheduleId changed).`);

    console.log('\n=== AFTER ===');
    await reportDay('July 1', '2026-07-01');
    await reportDay('July 2', '2026-07-02');
}

main()
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
