// Backfill PosDailySales for every Toast business day since Toast started
// (TOAST_FIRST_BUSINESS_DATE) through today — the same code path as the Ventas
// page's refresh button and the nightly cron, so the figures are identical.
// Idempotent: a day already stored is rewritten, nothing else is touched.
//
// Needs the Toast credentials (TOAST_API_HOSTNAME or TOAST_API_HOST,
// TOAST_CLIENT_ID, TOAST_CLIENT_SECRET, TOAST_RESTAURANT_GUID) and DATABASE_URL
// in .env.local / .env — read from there, never typed into this file.
//
// Run with: npx tsx scripts/backfill-toast-daily-sales.ts
//           npx tsx scripts/backfill-toast-daily-sales.ts --list   (dates only, no reads, no writes)
//           npx tsx scripts/backfill-toast-daily-sales.ts 2026-10-03 (one day)

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local', quiet: true });
loadEnv({ quiet: true });

import { TOAST_FIRST_BUSINESS_DATE, toastBusinessDatesSince } from '../src/lib/pos/toastBusinessDate';

const money = (cents: number) => (cents / 100).toFixed(2).padStart(10);

async function main() {
    const args = process.argv.slice(2);
    const one = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
    const dates = one ? [one] : toastBusinessDatesSince(TOAST_FIRST_BUSINESS_DATE);

    console.log(`${dates.length} Toast business day(s): ${dates[0]} → ${dates[dates.length - 1]}`);
    if (args.includes('--list')) return;

    // Imported here so --list never touches Prisma or Toast.
    const { snapshotToastDailySalesCore } = await import('../src/lib/pos/toastDailySales');
    const { default: prisma } = await import('../src/lib/prisma');

    try {
        console.log('date         paid        open       total   checks (paid/open)  note');
        let failed = 0;
        for (const date of dates) {
            const [r] = await snapshotToastDailySalesCore([date]);
            const total = r.netPaidCents + r.netOpenCents + r.surchargeCents + r.otherChargeCents;
            if (r.skipped) failed++;
            console.log(
                `${date}  ${money(r.netPaidCents)}  ${money(r.netOpenCents)}  ${money(total)}   ${String(r.paidChecks).padStart(4)} / ${String(r.openChecks).padEnd(4)}       ${r.skipped ?? ''}`
            );
        }
        console.log(failed ? `${failed} day(s) not written — see notes above; re-run for those dates.` : 'Done. Every day written.');
    } finally {
        await prisma.$disconnect();
    }
}

main().catch(e => {
    console.error('Backfill failed:', e instanceof Error ? e.message : e);
    process.exit(1);
});
