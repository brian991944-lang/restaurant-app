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
    /** Paid checks whose every settled payment was CASH, and their share of netPaidCents. */
    cashChecks: number;
    cashNetCents: number;
};

export const emptyDailySalesTotals = (): ToastDailySalesTotals => ({
    ordersScanned: 0, paidChecks: 0, openChecks: 0, voidedChecks: 0,
    netPaidCents: 0, netOpenCents: 0, refundCents: 0,
    surchargeCents: 0, gratuityCents: 0, otherChargeCents: 0,
    cashChecks: 0, cashNetCents: 0
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
    /** At least one settled payment, and every settled payment was CASH. */
    cashOnly: boolean;
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
    let settled = 0, cash = 0;
    for (const p of check?.payments ?? []) {
        if (UNSETTLED_PAYMENT.has(p?.paymentStatus)) continue;
        settled++;
        if (p?.type === 'CASH') cash++;
        refundCents += centsOf(p?.refund?.refundAmount);
    }

    return {
        salesCents: centsOf(check?.amount) - notSalesCents,
        refundCents,
        surchargeCents,
        gratuityCents,
        otherChargeCents,
        live,
        cashOnly: settled > 0 && cash === settled
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
                if (f.cashOnly) {
                    t.cashChecks++;
                    t.cashNetCents += f.salesCents - f.refundCents;
                }
            } else {
                t.openChecks++;
                t.netOpenCents += f.salesCents;
            }
        }
    }
    return t;
}

// ─── Items ──────────────────────────────────────────────────────────────────

export type ToastDailyItemRow = {
    kind: 'ITEM' | 'MODIFIER';
    posItemGuid: string;
    /** MODIFIER: the item it was sold on; '' for an ITEM. */
    parentPosItemGuid: string;
    displayName: string;
    paidQty: number;
    /** Toast's post-discount `price` over paid/closed checks; an ITEM's includes its modifiers. */
    paidCents: number;
    openQty: number;
    openCents: number;
    voidedQty: number;
};

/**
 * What sold on the day, per POS item and per modifier under its item, from
 * the same orders aggregateToastDailySales reads. The same checks count:
 * voided or deleted orders and checks put every selection under voidedQty,
 * as does a voided selection on a live check; deferred selections (gift
 * cards) and house-account payments are not sales and are left out. Money
 * is Toast's `price` on the selection: post-discount, quantity-adjusted and
 * — for an item — inclusive of its modifiers, which is why a day's ITEM rows
 * alone add up to its checks' amounts. Modifier rows carry their own price
 * for reference and are never added on top.
 *
 * `modifierKey` names a modifier that has no item guid of its own (Toast's
 * option-group modifiers) the way PosItemMapping keys them, so the caller
 * can resolve mappings; passed in to keep this file free of path aliases.
 */
export function aggregateToastDailyItems(orders: any[], modifierKey: (optionGroupGuid: string | null | undefined, name: string) => string): ToastDailyItemRow[] {
    const rows = new Map<string, ToastDailyItemRow>();
    const touch = (kind: 'ITEM' | 'MODIFIER', posItemGuid: string, parentPosItemGuid: string, displayName: string): ToastDailyItemRow => {
        const key = `${kind}|${posItemGuid}|${parentPosItemGuid}`;
        let row = rows.get(key);
        if (!row) {
            row = { kind, posItemGuid, parentPosItemGuid, displayName, paidQty: 0, paidCents: 0, openQty: 0, openCents: 0, voidedQty: 0 };
            rows.set(key, row);
        }
        return row;
    };
    const qtyOf = (sel: any): number => (typeof sel?.quantity === 'number' && Number.isFinite(sel.quantity) && sel.quantity >= 0 ? sel.quantity : 1);

    for (const order of orders) {
        const orderVoid = !!(order?.voided || order?.deleted || order?.excessFood === true);
        for (const check of order?.checks ?? []) {
            const checkVoid = orderVoid || !!(check?.voided || check?.deleted);
            const paid = isPaidCheck(check);
            for (const sel of check?.selections ?? []) {
                if (sel?.deferred === true || sel?.selectionType === 'HOUSE_ACCOUNT_PAY_BALANCE') continue;
                const itemGuid = typeof sel?.item?.guid === 'string' ? sel.item.guid : '';
                const name = String(sel?.displayName ?? '');
                const qty = qtyOf(sel);
                const voided = checkVoid || !!sel?.voided;
                const item = touch('ITEM', itemGuid, '', name);
                if (voided) item.voidedQty += qty;
                else if (paid) { item.paidQty += qty; item.paidCents += centsOf(sel?.price); }
                else { item.openQty += qty; item.openCents += centsOf(sel?.price); }

                // Modifiers nest; every level is a modifier of the top item, in units of the item sold.
                const visit = (list: any[]) => {
                    for (const m of list ?? []) {
                        const mName = String(m?.displayName ?? '');
                        const mGuid = typeof m?.item?.guid === 'string' ? m.item.guid : modifierKey(m?.optionGroup?.guid, mName);
                        const mQty = qtyOf(m) * qty;
                        const mod = touch('MODIFIER', mGuid, itemGuid, mName);
                        if (voided || m?.voided) mod.voidedQty += mQty;
                        else if (paid) { mod.paidQty += mQty; mod.paidCents += centsOf(m?.price); }
                        else { mod.openQty += mQty; mod.openCents += centsOf(m?.price); }
                        visit(m?.modifiers);
                    }
                };
                visit(sel?.modifiers);
            }
        }
    }
    return [...rows.values()];
}
