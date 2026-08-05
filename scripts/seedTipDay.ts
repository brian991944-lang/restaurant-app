/**
 * TEMPORARY — seeds one tip day with placeholder data for visual review.
 * Not application code. Delete after review.
 *
 *   npx --yes tsx scripts/seedTipDay.ts
 *
 * THE EMPLOYEE IDS BELOW ARE PLACEHOLDERS, NOT REAL CLOVER IDS. Every one
 * carries the SEED_ prefix, so every row this script creates is removable with
 * a single prefix match — see scripts/deleteTipSeed.ts. Nothing here will ever
 * collide with a genuine Clover employee id, and nothing should be treated as
 * a real person's tip record.
 */

import prisma from '@/lib/prisma';
import { getBusinessDateAsDate } from '@/lib/businessDay';
import { toCents, sumCents, formatMoney } from '@/lib/money';

/** Prefix that marks every row as disposable seed data. */
const SEED_PREFIX = 'SEED_';

const STAFF = [
    { id: 'SEED_E1', name: 'Jostin' },
    { id: 'SEED_E2', name: 'Gaby' },
    { id: 'SEED_E3', name: 'Roxi' },
    { id: 'SEED_E4', name: 'Jeremy' },
    { id: 'SEED_E5', name: 'Luana' }
];

const TOTAL_CREDIT = 1240.50;
const TOTAL_SERVICE = 186.00;
const TOTAL_CASH = 95.00;

type Plan = {
    shift: 0 | 1;
    role: 'MESERO' | 'BUSSER';
    creditTips: number;
    serviceCharge: number;
    /** null leaves the entry uncounted, so the warning state is visible. */
    cashTips: number | null;
};

// Credit and service sum exactly to the day totals. Cash deliberately falls
// short of 95.00 and one entry is left uncounted.
const PLAN: Plan[] = [
    { shift: 0, role: 'MESERO', creditTips: 380.25, serviceCharge: 57.00, cashTips: 30.00 },
    { shift: 0, role: 'MESERO', creditTips: 355.00, serviceCharge: 53.25, cashTips: 25.00 },
    { shift: 0, role: 'BUSSER', creditTips: 190.25, serviceCharge: 28.50, cashTips: null },
    { shift: 1, role: 'MESERO', creditTips: 205.00, serviceCharge: 30.75, cashTips: 20.00 },
    { shift: 1, role: 'BUSSER', creditTips: 110.00, serviceCharge: 16.50, cashTips: 12.50 }
];

async function main() {
    const staff = STAFF;

    if (staff.length < PLAN.length) {
        console.error(`STOPPED — need ${PLAN.length} staff members, have ${staff.length}.`);
        process.exitCode = 1;
        return;
    }
    // Guard the guard: a placeholder that lost its prefix would survive cleanup.
    const unprefixed = staff.filter(s => !s.id.startsWith(SEED_PREFIX));
    if (unprefixed.length > 0) {
        console.error(`STOPPED — these ids lack the ${SEED_PREFIX} prefix and would not be deletable: ${unprefixed.map(s => s.id).join(', ')}`);
        process.exitCode = 1;
        return;
    }

    // Verify the arithmetic in cents before touching the database.
    const creditSum = sumCents(PLAN.map(p => toCents(p.creditTips)));
    const serviceSum = sumCents(PLAN.map(p => toCents(p.serviceCharge)));
    const cashSum = sumCents(PLAN.map(p => toCents(p.cashTips ?? 0)));

    if (creditSum !== toCents(TOTAL_CREDIT)) {
        console.error(`STOPPED — credit tips sum to ${creditSum} cents, expected ${toCents(TOTAL_CREDIT)}.`);
        process.exitCode = 1;
        return;
    }
    if (serviceSum !== toCents(TOTAL_SERVICE)) {
        console.error(`STOPPED — service charge sums to ${serviceSum} cents, expected ${toCents(TOTAL_SERVICE)}.`);
        process.exitCode = 1;
        return;
    }
    if (cashSum >= toCents(TOTAL_CASH)) {
        console.error('STOPPED — cash was meant to fall short of the day total.');
        process.exitCode = 1;
        return;
    }

    const businessDate = getBusinessDateAsDate();
    await prisma.tipDay.deleteMany({ where: { businessDate } });

    const day = await prisma.tipDay.create({
        data: {
            businessDate,
            totalCreditTips: TOTAL_CREDIT,
            totalServiceCharge: TOTAL_SERVICE,
            totalCashTips: TOTAL_CASH,
            shifts: { create: [{ orderIndex: 0 }, { orderIndex: 1 }] }
        },
        include: { shifts: { orderBy: { orderIndex: 'asc' } } }
    });

    for (let i = 0; i < PLAN.length; i++) {
        const p = PLAN[i];
        const person = staff[i];
        await prisma.tipShiftEntry.create({
            data: {
                tipShiftId: day.shifts[p.shift].id,
                cloverEmployeeId: person.id,
                employeeName: person.name,
                role: p.role,
                creditTips: p.creditTips,
                serviceCharge: p.serviceCharge,
                cashTips: p.cashTips
            }
        });
    }

    console.log(`Seeded TipDay ${day.id} for ${businessDate.toISOString().slice(0, 10)}\n`);
    for (let i = 0; i < PLAN.length; i++) {
        const p = PLAN[i];
        console.log(
            `  Turno ${p.shift + 1}  ${staff[i].name.padEnd(14)} ${p.role.padEnd(7)}` +
            ` credit ${formatMoney(toCents(p.creditTips)).padStart(9)}` +
            ` service ${formatMoney(toCents(p.serviceCharge)).padStart(8)}` +
            ` cash ${p.cashTips === null ? 'SIN CONTAR' : formatMoney(toCents(p.cashTips)).padStart(8)}`
        );
    }
    const uncounted = PLAN.filter(p => p.cashTips === null).length;
    console.log('');
    console.log('  column sums, in cents:');
    console.log(`    credit  ${creditSum} / ${toCents(TOTAL_CREDIT)}   ${creditSum === toCents(TOTAL_CREDIT) ? 'BALANCES' : 'MISMATCH'}   (${formatMoney(creditSum)})`);
    console.log(`    service ${serviceSum} / ${toCents(TOTAL_SERVICE)}     ${serviceSum === toCents(TOTAL_SERVICE) ? 'BALANCES' : 'MISMATCH'}   (${formatMoney(serviceSum)})`);
    console.log(`    cash    ${cashSum} / ${toCents(TOTAL_CASH)}      SHORT ${toCents(TOTAL_CASH) - cashSum} cents (${formatMoney(toCents(TOTAL_CASH) - cashSum)}), ${uncounted} uncounted`);
}

main()
    .catch(e => {
        console.error(e);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
