/**
 * TEMPORARY — read-only probe of Clover's payments for one operational day.
 *
 * Exists to answer, before the tip sync is written: what a payment object
 * actually looks like, whether tips come back as tipAmount, how payments split
 * across tenders, whether Clover attributes a sale to the server who rang it or
 * to one shared terminal login, and where a service charge lives — which is on
 * the order, not the payment, so a few orders are pulled expanded. It writes
 * nothing, anywhere.
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

/** Group key for a payment that carries no tender or no employee at all. */
const MISSING = '(missing)';

/** How many payments' orders to pull, for the service-charge question. */
const ORDER_SAMPLE_SIZE = 5;

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

        // Anything that fails from here on is recorded rather than thrown: a
        // probe that returns the payments plus a note about which lookup was
        // refused is more useful than a 502 that returns nothing.
        const errors: Record<string, string> = {};

        // --- Tender breakdown -------------------------------------------------
        const tenderLabels = new Map<string, string>();
        try {
            const data = await cloverFetch('/tenders?limit=100');
            for (const tender of data?.elements ?? []) {
                if (tender?.id) tenderLabels.set(String(tender.id), String(tender.label ?? tender.labelKey ?? ''));
            }
        } catch (e) {
            errors.tenders = e instanceof Error ? e.message : String(e);
        }

        type TenderGroup = {
            tenderId: string;
            label: string | null;
            count: number;
            amountCents: number;
            tipAmountCents: number;
            missingTipAmountField: number;
        };
        const tenderGroups = new Map<string, TenderGroup>();
        for (const p of payments) {
            // A payment with no tender is its own group rather than being
            // dropped — a missing tender is itself a finding.
            const id = p?.tender?.id ? String(p.tender.id) : MISSING;
            let g = tenderGroups.get(id);
            if (!g) {
                g = { tenderId: id, label: null, count: 0, amountCents: 0, tipAmountCents: 0, missingTipAmountField: 0 };
                tenderGroups.set(id, g);
            }
            g.count++;
            if (typeof p?.amount === 'number') g.amountCents += p.amount;
            if (typeof p?.tipAmount === 'number') g.tipAmountCents += p.tipAmount;
            else g.missingTipAmountField++;
        }
        for (const g of tenderGroups.values()) {
            g.label = tenderLabels.get(g.tenderId) ?? null;
        }

        // --- Employee breakdown ----------------------------------------------
        // Answers whether Clover attributes a sale to the server who rang it or
        // to a single shared terminal login.
        const employeeNames = new Map<string, string>();
        try {
            const data = await cloverFetch('/employees?limit=100');
            for (const emp of data?.elements ?? []) {
                // Name only. Nothing else off the employee record is copied
                // here, for the same reason the wait-staff reader strips it.
                if (emp?.id) employeeNames.set(String(emp.id), String(emp.nickname || emp.name || ''));
            }
        } catch (e) {
            errors.employees = e instanceof Error ? e.message : String(e);
        }

        const employeeCounts = new Map<string, number>();
        for (const p of payments) {
            const id = p?.employee?.id ? String(p.employee.id) : MISSING;
            employeeCounts.set(id, (employeeCounts.get(id) ?? 0) + 1);
        }

        // --- Orders behind the first few payments -----------------------------
        // Fetched one at a time and expanded, because a service charge does not
        // travel on the payment. Deduplicated: two payments can settle one
        // order, and fetching it twice would only pad the sample.
        const sampleOrderIds = [...new Set(
            payments.slice(0, ORDER_SAMPLE_SIZE).map(p => p?.order?.id).filter(Boolean).map(String)
        )];

        const sampleOrdersRaw: any[] = [];
        const sampleOrderErrors: { orderId: string; error: string }[] = [];
        for (const orderId of sampleOrderIds) {
            try {
                sampleOrdersRaw.push(
                    await cloverFetch(`/orders/${orderId}?expand=lineItems,serviceCharge,payments`)
                );
            } catch (e) {
                sampleOrderErrors.push({ orderId, error: e instanceof Error ? e.message : String(e) });
            }
        }

        const orderKeySet = new Set<string>();
        for (const o of sampleOrdersRaw) {
            for (const k of Object.keys(o ?? {})) orderKeySet.add(k);
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
            tenders: {
                distinctTenderCount: tenderGroups.size,
                groups: [...tenderGroups.values()].sort((a, b) => b.count - a.count)
            },
            employees: {
                distinctEmployeeCount: employeeCounts.size,
                byEmployee: [...employeeCounts.entries()]
                    .map(([employeeId, paymentCount]) => ({
                        employeeId,
                        name: employeeNames.get(employeeId) ?? null,
                        paymentCount
                    }))
                    .sort((a, b) => b.paymentCount - a.paymentCount)
            },
            orders: {
                orderIdsProbed: sampleOrderIds,
                expand: 'lineItems,serviceCharge,payments',
                distinctTopLevelKeys: [...orderKeySet].sort(),
                fetchErrors: sampleOrderErrors
            },
            // Raw and unmodified, on purpose: this is the whole point of the
            // route. Nothing is stripped, renamed or flattened.
            sampleRaw: payments.slice(0, 3),
            sampleOrdersRaw,
            lookupErrors: errors
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
