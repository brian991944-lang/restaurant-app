/**
 * Pure arithmetic over one Toast business day of orders (ordersBulk): the
 * day's money as the app defines it. No I/O, so the refresh button, the
 * nightly cron and a one-off script all compute exactly the same figures.
 *
 * Definitions:
 * - Ventas netas (cobradas): checks whose paymentStatus is PAID or CLOSED.
 *   Item sales after discounts, minus refunds. No tax, no tips, no gratuity,
 *   and no service charge of any kind (the card surcharge included).
 * - Abierto: the same figure over checks still OPEN. Reported beside the
 *   paid figure, never added to it.
 * - Service charges are split three ways (card surcharge / gratuity / other),
 *   each summed over every live check whatever its payment status.
 *
 * Toast records a sale when a check opens, not when it is paid, and keeps
 * non-gratuity service charges inside net sales. So Toast's own figure is
 * cobrado + abierto + surcharge + other, which the UI shows as "Total Toast"
 * to reconcile against the Sales Summary.
 *
 * Arithmetic follows Toast's net-sales guide: start from check.amount (which
 * already reflects discounts and non-gratuity service charges and excludes
 * gratuity and tax), drop deferred and house-account selections, subtract
 * payment refunds (not tip refunds).
 *
 * Kept free of path aliases and TS-only syntax so a one-off Node script can
 * import it directly.
 */

import { centsOf, isCardSurcharge, UNSETTLED_PAYMENT } from './tips';

export type ToastDailySalesTotals = {
    ordersScanned: number;
    /** Live checks (not voided, with at least one live selection) by payment status. */
    paidChecks: number;
    openChecks: number;
    /** Checks dropped because the check or its order was voided or deleted. */
    voidedChecks: number;
    netPaidCents: number;
    netOpenCents: number;
    /** Already subtracted from netPaidCents; kept so a dry run can show it. */
    refundCents: number;
    surchargeCents: number;
    gratuityCents: number;
    otherChargeCents: number;
};

export const emptyDailySalesTotals = (): ToastDailySalesTotals => ({
    ordersScanned: 0, paidChecks: 0, openChecks: 0, voidedChecks: 0,
    netPaidCents: 0, netOpenCents: 0, refundCents: 0,
    surchargeCents: 0, gratuityCents: 0, otherChargeCents: 0
});

/** Toast's net sales for a day, from the stored or computed figures. */
export const toastTotalCents = (t: { netPaidCents: number; netOpenCents: number; surchargeCents: number; otherChargeCents: number }): number =>
    t.netPaidCents + t.netOpenCents + t.surchargeCents + t.otherChargeCents;

/** PAID (card run, tip not adjusted) and CLOSED both mean the money is in. */
export const isPaidCheck = (check: any): boolean =>
    check?.paymentStatus === 'PAID' || check?.paymentStatus === 'CLOSED';

type CheckFigures = {
    /** Item sales after discounts, before refunds. */
    salesCents: number;
    refundCents: number;
    surchargeCents: number;
    gratuityCents: number;
    otherChargeCents: number;
    /** At least one selection that is not voided. */
    live: boolean;
};

export function checkFigures(check: any): CheckFigures {
    let surchargeCents = 0, gratuityCents = 0, otherChargeCents = 0;
    // What check.amount carries that is not a sale. Toast keeps gratuity
    // charges out of amount already, so only non-gratuity ones come off.
    let notSalesCents = 0;

    for (const charge of check?.appliedServiceCharges ?? []) {
        const cents = centsOf(charge?.chargeAmount);
        const inAmount = charge?.gratuity !== true;
        if (isCardSurcharge(charge)) {
            surchargeCents += cents;
            if (inAmount) notSalesCents += cents;
        } else if (charge?.gratuity === true) {
            gratuityCents += cents;
        } else {
            otherChargeCents += cents;
            notSalesCents += cents;
        }
    }

    let live = false;
    for (const sel of check?.selections ?? []) {
        if (sel?.voided) continue;
        live = true;
        // Deferred revenue (a gift card sold) and paying down a house account
        // are money in, not sales. price is the selection's post-discount line.
        if (sel?.deferred === true || sel?.selectionType === 'HOUSE_ACCOUNT_PAY_BALANCE') {
            notSalesCents += centsOf(sel?.price);
        }
    }

    let refundCents = 0;
    for (const p of check?.payments ?? []) {
        if (UNSETTLED_PAYMENT.has(p?.paymentStatus)) continue;
        refundCents += centsOf(p?.refund?.refundAmount);
    }

    return {
        salesCents: centsOf(check?.amount) - notSalesCents,
        refundCents,
        surchargeCents,
        gratuityCents,
        otherChargeCents,
        live
    };
}

export function aggregateToastDailySales(orders: any[]): ToastDailySalesTotals {
    const t = emptyDailySalesTotals();
    t.ordersScanned = orders.length;

    for (const order of orders) {
        const checks: any[] = order?.checks ?? [];
        // excessFood: an order Toast itself keeps out of sales.
        if (order?.voided || order?.deleted || order?.excessFood === true) {
            t.voidedChecks += checks.length;
            continue;
        }
        for (const check of checks) {
            if (check?.voided || check?.deleted) {
                t.voidedChecks++;
                continue;
            }
            const f = checkFigures(check);
            if (!f.live) continue; // an empty check someone opened and never used

            t.surchargeCents += f.surchargeCents;
            t.gratuityCents += f.gratuityCents;
            t.otherChargeCents += f.otherChargeCents;

            if (isPaidCheck(check)) {
                t.paidChecks++;
                t.netPaidCents += f.salesCents - f.refundCents;
                t.refundCents += f.refundCents;
            } else {
                t.openChecks++;
                t.netOpenCents += f.salesCents;
            }
        }
    }
    return t;
}
