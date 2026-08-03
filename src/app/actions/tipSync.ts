'use server';

import prisma from '@/lib/prisma';
import { TipDayStatus } from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { cloverFetch } from '@/lib/clover';
import { getBusinessDate, getBusinessDayWindowUtc } from '@/lib/businessDay';

const TIPS_ROUTE = '/[locale]/tips-reviews';

const PAGE_SIZE = 100;
const MAX_PAGES = 50;

/** Orders in flight at once. cloverFetch backs off on a 429; this avoids one. */
const ORDER_CONCURRENCY = 3;

/**
 * Delivery platforms settle their own tips with their own couriers, so their
 * payments must not land in the restaurant's distribution.
 *
 * Matched against the tender LABEL rather than its id: ids are per-merchant and
 * a newly added delivery tender would sail through an id list, whereas anything
 * labelled for one of these platforms is caught the first time it appears.
 */
const EXCLUDED_TENDER = /uber\s*eats|door\s*dash/i;

/**
 * Stand-in id for payments Clover attributes to nobody.
 *
 * TipDayEmployeeTip.cloverEmployeeId is a required column, so an unattributed
 * group still needs a key. The underscore keeps it clear of Clover's own id
 * format, which is alphanumeric only.
 */
const UNASSIGNED_ID = 'SIN_ASIGNAR';
const UNASSIGNED_NAME = 'Sin asignar';

export type CloverTipSyncSummary = {
    businessDate: string;
    /** Every payment in the window, including the ones excluded below. */
    paymentsScanned: number;
    /** What actually fed the totals — scanned minus excluded. */
    paymentsCounted: number;
    ordersScanned: number;
    excludedPaymentCount: number;
    excludedTipCents: number;
    excludedAmountCents: number;
    cardTipsCents: number;
    serviceChargeCents: number;
    employeeCount: number;
    durationMs: number;
    /** True when the window held more pages of payments than the cap allows. */
    truncated: boolean;
};

const isBusinessDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * 'YYYY-MM-DD' as the Date a @db.Date column stores.
 *
 * Pinned to UTC midnight, exactly as getBusinessDateAsDate does — the two must
 * agree or a synced day and an edited day would be different rows.
 */
function businessDateToUtcDate(businessDate: string): Date {
    const [y, m, d] = businessDate.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Clover sends money as integer cents. Anything else reads as zero rather than
 * poisoning a sum, and nothing here is ever held as a float.
 */
const centsOf = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0;

/** Integer cents to the string a Decimal(10,2) column takes, exactly. */
const money = (cents: number): string => (cents / 100).toFixed(2);

/** Epoch millis off a Clover record; anything unusable sorts first. */
const millisOf = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : 0;

/** Run `worker` over `items`, never more than `limit` at once. */
async function mapWithConcurrency<T>(
    items: T[],
    limit: number,
    worker: (item: T) => Promise<void>
): Promise<void> {
    let cursor = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (true) {
            const i = cursor++;
            if (i >= items.length) return;
            await worker(items[i]);
        }
    });
    await Promise.all(runners);
}

/**
 * Read one operational day's card tips and service charges out of Clover and
 * cache them against the TipDay.
 *
 * Clover is authoritative for the two card figures: this sets
 * totalCreditTips and totalServiceCharge directly, so the day is reconciled
 * against what the POS actually settled rather than against a number somebody
 * typed. totalCashTips is never written here — cash does not pass through
 * Clover, and the only people who know it are the ones counting it.
 */
export async function syncCloverTips(businessDate?: string): Promise<{
    success: boolean;
    error?: string;
    summary?: CloverTipSyncSummary;
}> {
    const startedAt = Date.now();
    const date = businessDate ?? getBusinessDate();

    if (!isBusinessDate(date)) {
        return { success: false, error: 'La fecha no es válida.' };
    }

    try {
        const dateValue = businessDateToUtcDate(date);

        // A submitted day is a finished distribution. Moving its Clover figures
        // underneath it would leave the day reading as reconciled against
        // numbers nobody distributed.
        const existing = await prisma.tipDay.findUnique({
            where: { businessDate: dateValue },
            select: { status: true }
        });
        if (existing?.status === TipDayStatus.ENVIADO) {
            return {
                success: false,
                error: 'Este día ya fue enviado. Pide a un administrador que lo reabra antes de sincronizar con Clover.'
            };
        }

        const { start, end } = getBusinessDayWindowUtc(date);
        const startMs = start.getTime();
        const endMs = end.getTime();

        // --- Payments ---------------------------------------------------------
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

        // --- Tender exclusions ------------------------------------------------
        // Read once. A failure here fails the whole sync on purpose: without
        // labels the delivery platforms cannot be identified, and their tips
        // would silently inflate the day.
        const tenderLabels = new Map<string, string>();
        const tenderData = await cloverFetch('/tenders?limit=100');
        for (const tender of tenderData?.elements ?? []) {
            if (tender?.id) {
                tenderLabels.set(String(tender.id), String(tender.label ?? tender.labelKey ?? ''));
            }
        }

        const isExcluded = (p: any): boolean => {
            const id = p?.tender?.id ? String(p.tender.id) : null;
            // The label from /tenders is authoritative; the one embedded on the
            // payment is the fallback for a tender the list did not return.
            const label = (id ? tenderLabels.get(id) : undefined) ?? String(p?.tender?.label ?? '');
            return EXCLUDED_TENDER.test(label);
        };

        const counted: any[] = [];
        let excludedPaymentCount = 0;
        let excludedTipCents = 0;
        let excludedAmountCents = 0;
        for (const p of payments) {
            if (isExcluded(p)) {
                excludedPaymentCount++;
                excludedTipCents += centsOf(p?.tipAmount);
                excludedAmountCents += centsOf(p?.amount);
            } else {
                counted.push(p);
            }
        }

        const cardTipsCents = counted.reduce((sum, p) => sum + centsOf(p?.tipAmount), 0);

        // --- Service charges --------------------------------------------------
        // Not on the payment, so each order behind a counted payment is read.
        const orderIds = [...new Set(
            counted.map(p => p?.order?.id).filter(Boolean).map(String)
        )];

        const orderCharges = new Map<string, number>();
        await mapWithConcurrency(orderIds, ORDER_CONCURRENCY, async orderId => {
            // An order that cannot be read aborts the sync rather than being
            // skipped: a service-charge total short by one order is wrong, and
            // wrong is worse than absent for a figure people are paid against.
            const order = await cloverFetch(`/orders/${orderId}?expand=lineItems`);
            const lineItems: any[] = order?.lineItems?.elements ?? [];
            let cents = 0;
            for (const li of lineItems) {
                // orderFee.id is the real marker; isOrderFee catches a fee
                // configured since. Never the name — a rename is a display
                // change and must not silently zero the day.
                if (li?.orderFee?.id != null || li?.isOrderFee === true) {
                    cents += centsOf(li?.price);
                }
            }
            orderCharges.set(orderId, cents);
        });

        const serviceChargeCents = [...orderCharges.values()].reduce((sum, c) => sum + c, 0);

        // --- Per-employee breakdown -------------------------------------------
        const employeeNames = new Map<string, string>();
        const employeeData = await cloverFetch('/employees?limit=100');
        for (const emp of employeeData?.elements ?? []) {
            // Name only — nothing else off the employee record is copied.
            if (emp?.id) employeeNames.set(String(emp.id), String(emp.nickname || emp.name || ''));
        }

        const keyOf = (p: any) => (p?.employee?.id ? String(p.employee.id) : UNASSIGNED_ID);

        // An order is credited once, to whoever took the first payment on it.
        // Two payments can settle one order, and crediting both would make the
        // per-employee service charges sum to more than the day's.
        const byTime = [...counted].sort(
            (a, b) => millisOf(a?.createdTime) - millisOf(b?.createdTime)
        );
        const orderOwner = new Map<string, string>();
        for (const p of byTime) {
            const orderId = p?.order?.id ? String(p.order.id) : null;
            if (orderId && !orderOwner.has(orderId)) orderOwner.set(orderId, keyOf(p));
        }

        type Group = {
            cloverEmployeeId: string;
            employeeName: string;
            paymentCount: number;
            tipCents: number;
            salesCents: number;
            serviceCents: number;
        };
        const groups = new Map<string, Group>();
        const groupFor = (key: string): Group => {
            let g = groups.get(key);
            if (!g) {
                g = {
                    cloverEmployeeId: key,
                    employeeName: key === UNASSIGNED_ID
                        ? UNASSIGNED_NAME
                        : (employeeNames.get(key) || key),
                    paymentCount: 0,
                    tipCents: 0,
                    salesCents: 0,
                    serviceCents: 0
                };
                groups.set(key, g);
            }
            return g;
        };

        for (const p of counted) {
            const g = groupFor(keyOf(p));
            g.paymentCount++;
            g.tipCents += centsOf(p?.tipAmount);
            g.salesCents += centsOf(p?.amount);
        }
        for (const [orderId, key] of orderOwner) {
            groupFor(key).serviceCents += orderCharges.get(orderId) ?? 0;
        }

        // Everything above this line is the Clover round trip, which is what the
        // duration is meant to describe.
        const durationMs = Date.now() - startedAt;
        const syncedAt = new Date();

        // --- Write ------------------------------------------------------------
        const cloverFields = {
            cloverCreditTips: money(cardTipsCents),
            cloverServiceCharge: money(serviceChargeCents),
            // cloverCashTips is deliberately left alone: Clover has no cash tip
            // to report, and writing 0 would read as "counted, and none".
            cloverSyncedAt: syncedAt,
            cloverSyncDurationMs: durationMs,
            cloverOrdersScanned: orderIds.length,
            cloverPaymentsScanned: payments.length,

            // Clover is AUTHORITATIVE for these two. Card tips and the service
            // charge are what the POS settled; there is no version of them a
            // person should be typing in, so the sync sets the reconciliation
            // targets outright rather than proposing them.
            //
            // The manual "use this value" override was removed deliberately —
            // it existed when these were proposals, and leaving it would have
            // meant a hand-entered target that the next sync silently replaced.
            // Editing a submitted day still goes through
            // adminUpdateSubmittedDay, which audits.
            //
            // totalCashTips is NOT set here and must not be: cash never passes
            // through Clover, so the only source for it is the people counting
            // it. It is recorded per person and no longer reconciled at all.
            totalCreditTips: money(cardTipsCents),
            totalServiceCharge: money(serviceChargeCents)
        };

        await prisma.$transaction(async tx => {
            const day = await tx.tipDay.upsert({
                where: { businessDate: dateValue },
                create: {
                    businessDate: dateValue,
                    ...cloverFields,
                    // Same invariant ensureTipDay keeps: a day always has at
                    // least one shift, so the editor never opens empty.
                    shifts: { create: { orderIndex: 0 } }
                },
                update: cloverFields,
                select: { id: true }
            });

            // Wholesale refresh: the cache mirrors the last run and nothing else,
            // so an employee who no longer appears leaves with it.
            await tx.tipDayEmployeeTip.deleteMany({ where: { tipDayId: day.id } });

            if (groups.size > 0) {
                await tx.tipDayEmployeeTip.createMany({
                    data: [...groups.values()].map(g => ({
                        tipDayId: day.id,
                        cloverEmployeeId: g.cloverEmployeeId,
                        employeeName: g.employeeName,
                        paymentCount: g.paymentCount,
                        cardTips: money(g.tipCents),
                        serviceCharge: money(g.serviceCents),
                        salesAmount: money(g.salesCents),
                        syncedAt
                    }))
                });
            }
        });

        revalidatePath(TIPS_ROUTE);

        return {
            success: true,
            summary: {
                businessDate: date,
                paymentsScanned: payments.length,
                paymentsCounted: counted.length,
                ordersScanned: orderIds.length,
                excludedPaymentCount,
                excludedTipCents,
                excludedAmountCents,
                cardTipsCents,
                serviceChargeCents,
                employeeCount: groups.size,
                durationMs,
                truncated
            }
        };
    } catch (e) {
        console.error('Failed to sync Clover tips:', e);
        return { success: false, error: 'No se pudo sincronizar con Clover.' };
    }
}
