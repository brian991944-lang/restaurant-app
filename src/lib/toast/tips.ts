/**
 * Pure arithmetic over Toast orders: no I/O, so the sync action and a dry run
 * compute exactly the same figures.
 *
 * Kept free of path aliases and TS-only syntax so a one-off Node script can
 * import it directly.
 */

/**
 * Payments that never settled. Their tipAmount is not money anyone received.
 * ERROR_NETWORK and CANCELLED are failure states alongside ERROR and DENIED.
 */
const UNSETTLED_PAYMENT = new Set(['VOIDED', 'DENIED', 'ERROR', 'ERROR_NETWORK', 'CANCELLED']);

/** Key for tips on a check with no server attached. */
export const UNASSIGNED_KEY = 'SIN_ASIGNAR';

/** Toast sends money as decimal dollars; everything here is integer cents. */
export const centsOf = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) : 0;

export type ToastServerTotals = {
    /** Toast employee GUID of the CHECK's server, or UNASSIGNED_KEY. */
    serverGuid: string;
    checkCount: number;
    paymentCount: number;
    tipCents: number;
    tipRefundCents: number;
    serviceChargeCents: number;
    salesCents: number;
};

export type ToastTipAggregate = {
    ordersScanned: number;
    ordersCounted: number;
    checksCounted: number;
    paymentsScanned: number;
    paymentsCounted: number;
    unsettledPaymentCount: number;
    tipCents: number;
    tipRefundCents: number;
    serviceChargeCents: number;
    servers: ToastServerTotals[];
};

/**
 * Card tips and service charges for one day of Toast orders.
 *
 * - Voided or deleted orders and checks are skipped entirely.
 * - Payments in an unsettled state are skipped.
 * - Tips are non-cash only, net of any tip refund.
 * - Service charges are every applied charge on a counted check, gratuity or not.
 * - Everything is credited to the CHECK's server (falling back to the order's,
 *   which is where ordersBulk actually puts it), never the payment's: the
 *   person who ran the table earns the tip even when someone else took the
 *   card. This is what reproduces Toast's own payroll tip figures.
 */
export function aggregateToastTips(orders: any[]): ToastTipAggregate {
    const servers = new Map<string, ToastServerTotals>();
    const serverFor = (guid: string): ToastServerTotals => {
        let s = servers.get(guid);
        if (!s) {
            s = { serverGuid: guid, checkCount: 0, paymentCount: 0, tipCents: 0, tipRefundCents: 0, serviceChargeCents: 0, salesCents: 0 };
            servers.set(guid, s);
        }
        return s;
    };

    let ordersCounted = 0, checksCounted = 0, paymentsScanned = 0, paymentsCounted = 0, unsettledPaymentCount = 0;
    let tipCents = 0, tipRefundCents = 0, serviceChargeCents = 0;

    for (const order of orders) {
        const checks: any[] = order?.checks ?? [];
        for (const check of checks) paymentsScanned += (check?.payments ?? []).length;
        if (order?.voided || order?.deleted) continue;
        ordersCounted++;

        for (const check of checks) {
            if (check?.voided || check?.deleted) continue;
            checksCounted++;
            // Toast's documented Check has a server, but ordersBulk does not
            // return it — the server comes on the order. The check's is used
            // whenever Toast does send one.
            const serverGuid = check?.server?.guid ?? order?.server?.guid;
            const s = serverFor(typeof serverGuid === 'string' ? serverGuid : UNASSIGNED_KEY);
            s.checkCount++;

            for (const p of check?.payments ?? []) {
                if (UNSETTLED_PAYMENT.has(p?.paymentStatus)) {
                    unsettledPaymentCount++;
                    continue;
                }
                paymentsCounted++;
                s.paymentCount++;
                s.salesCents += centsOf(p?.amount);
                if (p?.type === 'CASH') continue;

                const refund = centsOf(p?.refund?.tipRefundAmount);
                const net = centsOf(p?.tipAmount) - refund;
                s.tipCents += net;
                s.tipRefundCents += refund;
                tipCents += net;
                tipRefundCents += refund;
            }

            for (const charge of check?.appliedServiceCharges ?? []) {
                const c = centsOf(charge?.chargeAmount);
                s.serviceChargeCents += c;
                serviceChargeCents += c;
            }
        }
    }

    return {
        ordersScanned: orders.length,
        ordersCounted,
        checksCounted,
        paymentsScanned,
        paymentsCounted,
        unsettledPaymentCount,
        tipCents,
        tipRefundCents,
        serviceChargeCents,
        servers: [...servers.values()].sort((a, b) => b.tipCents - a.tipCents)
    };
}

export type EmployeeTipRow = {
    /** EmployeeRate.cloverEmployeeId when mapped; otherwise a TOAST: key. */
    cloverEmployeeId: string;
    employeeName: string;
    paymentCount: number;
    tipCents: number;
    serviceChargeCents: number;
    salesCents: number;
    matched: boolean;
};

/**
 * Per-server totals keyed the way the rest of the app keys people.
 *
 * A server mapped through EmployeeRate.toastEmployeeGuid is stored under that
 * row's cloverEmployeeId. One that is not is stored under "TOAST:<guid>" with
 * Toast's name, and reported back as unmatched — never guessed by name.
 */
export function toEmployeeTipRows(
    servers: ToastServerTotals[],
    rates: { cloverEmployeeId: string; employeeName: string; toastEmployeeGuid: string | null }[],
    toastNames: Map<string, string>
): EmployeeTipRow[] {
    const byGuid = new Map(rates.filter(r => r.toastEmployeeGuid).map(r => [r.toastEmployeeGuid, r]));
    return servers
        .map(s => {
            if (s.serverGuid === UNASSIGNED_KEY) {
                return { cloverEmployeeId: UNASSIGNED_KEY, employeeName: 'Sin asignar', paymentCount: s.paymentCount, tipCents: s.tipCents, serviceChargeCents: s.serviceChargeCents, salesCents: s.salesCents, matched: false };
            }
            const rate = byGuid.get(s.serverGuid);
            return {
                cloverEmployeeId: rate ? rate.cloverEmployeeId : `TOAST:${s.serverGuid}`,
                employeeName: rate ? rate.employeeName : (toastNames.get(s.serverGuid) || s.serverGuid),
                paymentCount: s.paymentCount,
                tipCents: s.tipCents,
                serviceChargeCents: s.serviceChargeCents,
                salesCents: s.salesCents,
                matched: !!rate
            };
        });
}
