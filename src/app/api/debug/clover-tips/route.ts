/**
 * TEMPORARY — read-only probe of Clover's payments for one operational day.
 *
 * Exists to answer, before the tip sync is written: what a payment object
 * actually looks like, whether tips come back as tipAmount, how payments split
 * across tenders, whether Clover attributes a sale to the server who rang it or
 * to one shared terminal login, and where a service charge lives — which is not
 * on the payment, so every order in the window is pulled expanded and checked
 * in all four places one could sit. It writes nothing, anywhere.
 *
 * Runs on Vercel rather than locally because CLOVER_MERCHANT_ID and
 * CLOVER_API_TOKEN only exist in the deployed environment.
 *
 *   GET /api/debug/clover-tips            → current business date
 *   GET /api/debug/clover-tips?date=2026-08-01
 *   GET /api/debug/clover-tips?employees=1 → employee roster only, no scan
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

/** How many orders to probe with the dedicated service-charge sub-resource. */
const ORDER_SAMPLE_SIZE = 5;

/**
 * Orders are fetched a few at a time. cloverFetch already backs off on a 429,
 * but three in flight keeps a busy day from provoking one in the first place.
 */
const ORDER_CONCURRENCY = 3;

/** Ceiling on the order scan, so one very long day cannot run past the
 *  function's timeout. Reported when it bites. */
const MAX_ORDERS = 500;

/** Roster page size. Larger than the merchant's staff has ever been. */
const ROSTER_LIMIT = 200;

const isBusinessDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

type RosterEmployee = {
    id: string;
    name: string;
    nickname: string;
    roles: string[];
    /** Which query returned this row, not a field copied off the record. */
    source: 'active' | 'deleted-filter';
};

/**
 * An employee record reduced to the four things a name-mapping exercise needs.
 * Built field by field so nothing else Clover holds — pin, email, customId, or
 * anything it adds later — can reach the response.
 */
function toRoster(raw: any, source: RosterEmployee['source']): RosterEmployee {
    return {
        id: String(raw?.id ?? ''),
        name: String(raw?.name ?? ''),
        nickname: String(raw?.nickname ?? ''),
        roles: (raw?.roles?.elements ?? [])
            .map((r: any) => (typeof r?.name === 'string' ? r.name : ''))
            .filter(Boolean),
        source
    };
}

/** Run `worker` over `items`, never more than `limit` at once, preserving order. */
async function mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    worker: (item: T) => Promise<R>
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let cursor = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (true) {
            const i = cursor++;
            if (i >= items.length) return;
            results[i] = await worker(items[i]);
        }
    });
    await Promise.all(runners);
    return results;
}

const asCents = (v: any): number | null => (typeof v === 'number' ? v : null);

/** Amount on a service-charge node, which Clover may send bare or wrapped in elements. */
function chargeAmountCents(node: any): number {
    if (!node) return 0;
    if (Array.isArray(node.elements)) {
        return node.elements.reduce(
            (sum: number, el: any) => sum + (asCents(el?.amount) ?? asCents(el?.price) ?? 0),
            0
        );
    }
    return asCents(node.amount) ?? asCents(node.price) ?? 0;
}

const looksLikeServiceName = (name: any) =>
    typeof name === 'string' && /service|surcharge/i.test(name);

/**
 * Look for a service charge in all four places it could plausibly sit, and
 * report which ones hit rather than stopping at the first.
 *
 * The amount is taken from a single source to avoid counting the same money
 * twice: a top-level field when there is one, otherwise the matching line
 * items, unioned by id so a line item that is both an order fee and named
 * "service" is only added once.
 */
function detectServiceCharge(order: any): { hits: string[]; amountCents: number } {
    const hits: string[] = [];

    const hasServiceCharge = order?.serviceCharge != null;
    const hasServiceCharges = order?.serviceCharges != null;
    if (hasServiceCharge) hits.push('order.serviceCharge');
    if (hasServiceCharges) hits.push('order.serviceCharges');

    const lineItems: any[] = order?.lineItems?.elements ?? [];
    const feeItems = lineItems.filter(li => li?.isOrderFee === true);
    const namedItems = lineItems.filter(li => looksLikeServiceName(li?.name));
    if (feeItems.length > 0) hits.push('lineItem.isOrderFee');
    if (namedItems.length > 0) hits.push('lineItem.name~service|surcharge');

    let amountCents = 0;
    if (hasServiceCharge) {
        amountCents = chargeAmountCents(order.serviceCharge);
    } else if (hasServiceCharges) {
        amountCents = chargeAmountCents(order.serviceCharges);
    } else {
        const seen = new Set<any>();
        for (const li of [...feeItems, ...namedItems]) {
            const id = li?.id ?? li;
            if (seen.has(id)) continue;
            seen.add(id);
            amountCents += asCents(li?.price) ?? asCents(li?.amount) ?? 0;
        }
    }

    return { hits, amountCents };
}

export async function GET(req: NextRequest) {
    // Same cookie gate as every other admin-only surface. Checked before the
    // window is computed and long before Clover is contacted.
    if (!isAdminRequest(req)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Roster mode. A name off a January spreadsheet has to be matched to a
    // Clover id, and nothing in the payment scan below helps with that — so it
    // is skipped entirely rather than run and discarded.
    if (req.nextUrl.searchParams.get('employees')) {
        try {
            const byId = new Map<string, RosterEmployee>();
            const lookupErrors: Record<string, string> = {};

            const active = await cloverFetch(`/employees?limit=${ROSTER_LIMIT}&expand=roles`);
            const activeRows: any[] = active?.elements ?? [];
            for (const emp of activeRows) {
                const row = toRoster(emp, 'active');
                if (row.id) byId.set(row.id, row);
            }

            // Best effort. Clover omits deleted employees from /employees and
            // documents no way to ask for them, so this may simply be rejected;
            // the error is reported rather than thrown, because the active
            // roster is worth having either way. Anyone already returned above
            // keeps their 'active' source.
            try {
                const gone = await cloverFetch(
                    `/employees?limit=${ROSTER_LIMIT}&expand=roles&filter=deleted=true`
                );
                for (const emp of gone?.elements ?? []) {
                    const row = toRoster(emp, 'deleted-filter');
                    if (row.id && !byId.has(row.id)) byId.set(row.id, row);
                }
            } catch (e) {
                lookupErrors.deletedFilter = e instanceof Error ? e.message : String(e);
            }

            return NextResponse.json({
                mode: 'employees',
                limit: ROSTER_LIMIT,
                truncated: activeRows.length >= ROSTER_LIMIT,
                employeeCount: byId.size,
                employees: [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'es')),
                lookupErrors,
                note: 'A name with no match here probably belongs to a deleted employee. '
                    + 'Clover hides those from /employees; the id can still be recovered from '
                    + 'employee.id on one of that person\'s payments in a day they worked.'
            });
        } catch (e) {
            return NextResponse.json(
                { mode: 'employees', error: e instanceof Error ? e.message : String(e) },
                { status: 502 }
            );
        }
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
        // A service charge does not travel on the payment, so every order behind
        // the window's payments is fetched and inspected. Deduplicated: two
        // payments can settle one order.
        const allOrderIds = [...new Set(
            payments.map(p => p?.order?.id).filter(Boolean).map(String)
        )];
        const orderIds = allOrderIds.slice(0, MAX_ORDERS);
        const orderScanTruncated = allOrderIds.length > orderIds.length;

        const scanStartedAt = Date.now();
        const scanned = await mapWithConcurrency(orderIds, ORDER_CONCURRENCY, async orderId => {
            try {
                const order = await cloverFetch(`/orders/${orderId}?expand=serviceCharge,lineItems`);
                return { orderId, order, error: null as string | null };
            } catch (e) {
                // Returned rather than thrown: one unreadable order must not
                // abandon the scan of all the others.
                return { orderId, order: null, error: e instanceof Error ? e.message : String(e) };
            }
        });
        const scanElapsedMs = Date.now() - scanStartedAt;

        const orderFetchErrors = scanned
            .filter(r => r.error !== null)
            .map(r => ({ orderId: r.orderId, error: r.error as string }));
        const orders = scanned.filter(r => r.order !== null).map(r => r.order);

        const found = scanned
            .filter(r => r.order !== null)
            .map(r => ({ orderId: r.orderId, order: r.order, detection: detectServiceCharge(r.order) }))
            .filter(r => r.detection.hits.length > 0);

        const serviceChargeTotalCents = found.reduce((sum, r) => sum + r.detection.amountCents, 0);

        // Which of the four places actually carried the charge, counted across
        // the day. This is the answer the sync pass needs.
        const hitCounts: Record<string, number> = {};
        for (const r of found) {
            for (const hit of r.detection.hits) hitCounts[hit] = (hitCounts[hit] ?? 0) + 1;
        }

        const orderKeySet = new Set<string>();
        for (const o of orders) {
            for (const k of Object.keys(o ?? {})) orderKeySet.add(k);
        }

        // The dedicated sub-resource, tried separately because it is the most
        // likely home for the charge and may simply not be enabled.
        const serviceChargeEndpointProbe: {
            orderId: string;
            raw: any;
            error: string | null;
        }[] = [];
        for (const orderId of orderIds.slice(0, ORDER_SAMPLE_SIZE)) {
            try {
                serviceChargeEndpointProbe.push({
                    orderId,
                    raw: await cloverFetch(`/orders/${orderId}/service_charges`),
                    error: null
                });
            } catch (e) {
                serviceChargeEndpointProbe.push({
                    orderId,
                    raw: null,
                    error: e instanceof Error ? e.message : String(e)
                });
            }
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
            serviceCharges: {
                expand: 'serviceCharge,lineItems',
                concurrency: ORDER_CONCURRENCY,
                ordersScanned: orders.length,
                orderIdsSeen: allOrderIds.length,
                scanTruncated: orderScanTruncated,
                scanElapsedMs,
                ordersWithServiceCharge: found.length,
                serviceChargeTotalCents,
                serviceChargeTotalDollars: serviceChargeTotalCents / 100,
                // Which of the four checked locations hit, and how often.
                hitsByLocation: hitCounts,
                found: found.map(r => ({
                    orderId: r.orderId,
                    where: r.detection.hits,
                    amountCents: r.detection.amountCents
                })),
                distinctOrderTopLevelKeys: [...orderKeySet].sort(),
                fetchErrors: orderFetchErrors,
                // Said plainly rather than left to be inferred from an empty array.
                note: found.length === 0
                    ? 'NO SERVICE CHARGE FOUND in any of the four checked locations across every order in the window. sampleOrdersRaw holds the first order scanned so the real shape is still visible.'
                    : `Service charge found on ${found.length} of ${orders.length} orders.`
            },
            // The dedicated sub-resource, probed separately.
            serviceChargeEndpointProbe,
            // Raw and unmodified, on purpose: this is the whole point of the
            // route. Nothing is stripped, renamed or flattened.
            sampleRaw: payments.slice(0, 3),
            // The first two orders that actually carry a charge — or, if none do,
            // the first order scanned, so there is always something to read.
            sampleOrdersRaw: found.length > 0
                ? found.slice(0, 2).map(r => r.order)
                : orders.slice(0, 1),
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
