/**
 * TEMPORARY — read-only probe of Clover's payments for one operational day.
 *
 * Exists to answer three questions before the tip sync is written: what a
 * payment object actually looks like, whether tips come back as tipAmount, and
 * where a service charge lives. It writes nothing, anywhere.
 *
 * Runs on Vercel rather than locally because CLOVER_MERCHANT_ID and
 * CLOVER_API_TOKEN only exist in the deployed environment.
 *
 *   GET /api/debug/clover-tips            → current business date
 *   GET /api/debug/clover-tips?date=2026-08-01
 *
 * Delete once the sync lands.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/adminGuard';
import { cloverFetch } from '@/lib/clover';
import { getBusinessDate, getBusinessDayWindowUtc, BUSINESS_DAY_CUTOVER_HOUR } from '@/lib/businessDay';

export const dynamic = 'force-dynamic';

/** How many payments to pull per request, and the ceiling on how many pages. */
const PAGE_SIZE = 100;
const MAX_PAGES = 50;

const isBusinessDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function GET(req: NextRequest) {
    // Same cookie gate as every other admin-only surface. Checked before the
    // window is computed and long before Clover is contacted.
    if (!isAdminRequest(req)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const requested = req.nextUrl.searchParams.get('date');
    if (requested !== null && !isBusinessDate(requested)) {
        return NextResponse.json(
            { error: `Invalid date "${requested}". Expected YYYY-MM-DD.` },
            { status: 400 }
        );
    }

    const businessDate = requested ?? getBusinessDate();
    // 05:00 NY through 04:59:59.999 the next morning, straight from the shared
    // cutover constant — this route does not get its own idea of a day.
    const { start, end } = getBusinessDayWindowUtc(businessDate);
    const startMs = start.getTime();
    const endMs = end.getTime();

    const window = {
        businessDate,
        cutoverHourNy: BUSINESS_DAY_CUTOVER_HOUR,
        startIso: start.toISOString(),
        endIso: end.toISOString(),
        startMs,
        endMs
    };

    try {
        // Credentials are read here, inside the handler, by cloverFetch — never
        // at module scope, so importing this route cannot fail at build time.
        const payments: any[] = [];
        let offset = 0;
        let pages = 0;
        let truncated = false;

        while (true) {
            if (pages >= MAX_PAGES) {
                truncated = true;
                break;
            }
            const data = await cloverFetch(
                `/payments?filter=createdTime>=${startMs}&filter=createdTime<=${endMs}&limit=${PAGE_SIZE}&offset=${offset}`
            );
            const page: any[] = data?.elements ?? [];
            payments.push(...page);
            pages++;
            if (page.length < PAGE_SIZE) break;
            offset += PAGE_SIZE;
        }

        // Integer cents, as Clover sends them. Anything non-numeric is counted
        // separately rather than coerced, so a surprise shape is visible here
        // instead of silently reading as zero.
        let tipAmountTotal = 0;
        let paymentsWithTip = 0;
        let paymentsWithoutTipAmountField = 0;
        for (const p of payments) {
            if (typeof p?.tipAmount === 'number') {
                tipAmountTotal += p.tipAmount;
                if (p.tipAmount !== 0) paymentsWithTip++;
            } else {
                paymentsWithoutTipAmountField++;
            }
        }

        // Every top-level key seen anywhere in the window — the point is to spot
        // whichever field carries the service charge.
        const keySet = new Set<string>();
        for (const p of payments) {
            for (const k of Object.keys(p ?? {})) keySet.add(k);
        }

        return NextResponse.json({
            window,
            request: {
                endpoint: '/payments',
                filters: [`createdTime>=${startMs}`, `createdTime<=${endMs}`],
                pageSize: PAGE_SIZE,
                pagesFetched: pages,
                truncated
            },
            paymentCount: payments.length,
            tips: {
                tipAmountTotalCents: tipAmountTotal,
                tipAmountTotalDollars: tipAmountTotal / 100,
                paymentsWithNonZeroTip: paymentsWithTip,
                paymentsMissingTipAmountField: paymentsWithoutTipAmountField
            },
            distinctTopLevelKeys: [...keySet].sort(),
            // Raw and unmodified, on purpose: this is the whole point of the
            // route. Nothing is stripped, renamed or flattened.
            sampleRaw: payments.slice(0, 3)
        });
    } catch (e) {
        // Surfaced as JSON so a missing credential or a Clover error reads
        // plainly instead of arriving as an HTML error page.
        return NextResponse.json(
            {
                window,
                error: e instanceof Error ? e.message : String(e)
            },
            { status: 502 }
        );
    }
}
