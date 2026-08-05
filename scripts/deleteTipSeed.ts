/**
 * TEMPORARY — removes everything scripts/seedTipDay.ts created.
 * Not application code. Delete alongside the seed script.
 *
 *   npx --yes tsx scripts/deleteTipSeed.ts
 *
 * Deletes only entries whose cloverEmployeeId starts with SEED_, then cleans up
 * shifts and days that are left empty as a result. A day that still holds real
 * entries is never touched, and neither is a shift belonging to one.
 */

import prisma from '@/lib/prisma';

const SEED_PREFIX = 'SEED_';

async function main() {
    const entries = await prisma.tipShiftEntry.findMany({
        where: { cloverEmployeeId: { startsWith: SEED_PREFIX } },
        select: {
            id: true,
            cloverEmployeeId: true,
            employeeName: true,
            tipShift: { select: { id: true, orderIndex: true, tipDayId: true } }
        }
    });

    if (entries.length === 0) {
        console.log(`No entries with the ${SEED_PREFIX} prefix — nothing to remove.`);
        return;
    }

    // Candidate parents, captured before the delete so they can be re-checked.
    const shiftIds = [...new Set(entries.map(e => e.tipShift.id))];
    const dayIds = [...new Set(entries.map(e => e.tipShift.tipDayId))];

    console.log(`Removing ${entries.length} seed ${entries.length === 1 ? 'entry' : 'entries'}:`);
    for (const e of entries) {
        console.log(`  ${e.cloverEmployeeId.padEnd(9)} ${e.employeeName.padEnd(10)} (turno ${e.tipShift.orderIndex + 1})`);
    }

    await prisma.tipShiftEntry.deleteMany({
        where: { cloverEmployeeId: { startsWith: SEED_PREFIX } }
    });

    // Only remove a shift if nothing at all is left on it — a shift that still
    // holds a real entry stays, even if it also held seed rows.
    const emptyShifts = await prisma.tipShift.findMany({
        where: { id: { in: shiftIds }, entries: { none: {} } },
        select: { id: true, orderIndex: true }
    });
    if (emptyShifts.length > 0) {
        await prisma.tipShift.deleteMany({ where: { id: { in: emptyShifts.map(s => s.id) } } });
    }
    console.log(`\nRemoved ${emptyShifts.length} now-empty ${emptyShifts.length === 1 ? 'shift' : 'shifts'}.`);

    // Same rule one level up: a day with any surviving entry is left alone.
    const emptyDays = await prisma.tipDay.findMany({
        where: { id: { in: dayIds }, shifts: { every: { entries: { none: {} } } } },
        select: { id: true, businessDate: true }
    });
    if (emptyDays.length > 0) {
        // Remaining empty shifts cascade with the day.
        await prisma.tipDay.deleteMany({ where: { id: { in: emptyDays.map(d => d.id) } } });
        for (const d of emptyDays) {
            console.log(`Removed empty TipDay ${d.businessDate.toISOString().slice(0, 10)} (${d.id}).`);
        }
    } else {
        console.log('No TipDay left empty — none removed.');
    }
}

main()
    .catch(e => {
        console.error(e);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
