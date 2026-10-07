import { NextResponse } from 'next/server';
import { syncCloverSales } from '@/app/actions/clover';
import { runToastConsumptionCore } from '@/lib/pos/toastConsumption';
import { lastToastBusinessDates } from '@/lib/pos/toastBusinessDate';

// This function receives a GET request and triggers the sync manually via Cron
export async function GET(request: Request) {
    try {
        // Simple security layer: require a secret token in the Authorization Header
        // In Vercel Cron, you configure providing a custom header. 
        // e.g. Authorization: Bearer CRON_SECRET_1234
        const authHeader = request.headers.get('authorization');
        const isVercelCron = request.headers.get('user-agent')?.startsWith('vercel-cron');

        const expectedAuth = `Bearer ${process.env.CRON_SECRET || 'secret-clover-cron-key-123'}`;

        if (authHeader !== expectedAuth && !isVercelCron) {
            return new NextResponse('Unauthorized', { status: 401 });
        }

        console.log("Starting Scheduled Clover Sync via Cron...");
        const result = await syncCloverSales();

        // Toast consumption: off unless explicitly enabled. Re-runs the last 3
        // Toast business days so late voids are reversed. A failure here is
        // reported but does not undo or fail the Clover sync above.
        let toast: unknown = 'disabled';
        if (process.env.TOAST_CONSUMPTION_ENABLED === 'true') {
            try {
                const reports = await runToastConsumptionCore(lastToastBusinessDates(3), { dryRun: false });
                toast = reports.map(r => ({
                    date: r.date, skipped: r.skipped, lines: r.lines, applied: r.applied,
                    reversed: r.reversed, unmapped: r.unmapped.length, errors: r.errors.length
                }));
            } catch (e) {
                console.error('Cron Toast consumption failed:', e instanceof Error ? e.message : e);
                toast = { error: e instanceof Error ? e.message : String(e) };
            }
        }

        if (result.success) {
            return NextResponse.json({
                status: 'success',
                message: `Successfully synced ${result.count} items.`,
                toast
            });
        } else {
            return NextResponse.json({
                status: 'error',
                message: result.error || 'Failed to sync'
            }, { status: 500 });
        }
    } catch (error) {
        console.error("Cron Clover Sync Failed: ", error);
        return new NextResponse('Internal Server Error', { status: 500 });
    }
}
