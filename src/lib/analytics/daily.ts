/**
 * What the Resumen dashboard says about a window of PosDailySales rows.
 *
 * Pure functions over DailySalesRow (src/lib/pos/toastDailySales.ts), the
 * same rows the Ventas table shows, so a figure here always agrees with that
 * table. Integer cents in, integer cents out; a day never read (computedAt
 * null) is left out of every sum and counted in `unreadDays` instead, because
 * a zero that stands for "not read yet" would read as a day with no sales.
 */

import type { DailySalesRow, SalesErrorCode } from '@/lib/pos/toastDailySales';
import { shiftDate } from '@/lib/pos/toastBusinessDate';
import type { DateRange } from './range';

/** What actions/analytics.ts answers. Declared here because a 'use server' module may export only actions. */
export type AnalyticsDailyResult = {
    success: boolean;
    /** Spanish, for logs; the dashboard translates `code`. */
    error?: string;
    code?: SalesErrorCode;
    /** Today's Toast business date, so the client can place "today" and the forecast. */
    today: string;
    range: DateRange;
    /** One row per day of the window, oldest first. */
    rows: DailySalesRow[];
    /** The same-length window before this one, only when it exists in full. */
    previous: { range: DateRange; rows: DailySalesRow[] } | null;
};

/** A day that has been read, so its figures are real. */
export const isRead = (r: DailySalesRow) => r.computedAt !== null;

/** Toast's own net sales: it counts open checks and non-gratuity service charges. */
export const toastTotalCents = (r: DailySalesRow) => r.netPaidCents + r.netOpenCents + r.surchargeCents + r.otherChargeCents;

/** Group gratuity plus any other service charge — the "Cargo por servicio" card. */
export const serviceChargeCents = (r: DailySalesRow) => r.gratuityCents + r.otherChargeCents;

export type DailySummary = {
    /** Days in the window with figures. */
    days: number;
    /** Days in the window never read. A day read before the cash figures existed still counts here as read; `cashDays` is where it is missing. */
    unreadDays: number;
    netPaidCents: number;
    netOpenCents: number;
    paidChecks: number;
    openChecks: number;
    surchargeCents: number;
    /** Group gratuity plus other service charges — the "Cargo por servicio" card. */
    serviceChargeCents: number;
    gratuityCents: number;
    otherChargeCents: number;
    /** Over the days whose cash figures exist; `cashDays` says how many that is. */
    cashNetCents: number;
    cashChecks: number;
    cashDays: number;
    /** Net sales and checks not settled only in cash (card, split, gift card…), over the same `cashDays`. */
    cardNetCents: number;
    cardChecks: number;
    /** Net sales per paid check, rounded to the cent; null without a paid check. */
    avgTicketCents: number | null;
    /** Net sales per read day, rounded to the cent; null without a read day. */
    avgNetPerDayCents: number | null;
    /** Days whose checks are not all closed — one line per day, newest first. */
    openDays: { date: string; openChecks: number; netOpenCents: number }[];
};

/**
 * A read day's net sales split by how its checks were settled: the checks
 * paid only in cash, and everything else (card, split tenders, gift cards).
 * Null for a day read before the cash figures existed — the split is
 * unknown, not zero.
 */
export function splitTender(r: DailySalesRow): { cashNetCents: number; cashChecks: number; cardNetCents: number; cardChecks: number } | null {
    if (!isRead(r) || r.cashChecks === null || r.cashNetCents === null) return null;
    return {
        cashNetCents: r.cashNetCents,
        cashChecks: r.cashChecks,
        cardNetCents: r.netPaidCents - r.cashNetCents,
        cardChecks: r.paidChecks - r.cashChecks
    };
}

/** Toast's own total over a summary, the way toastTotalCents builds it for one day. */
export const toastTotalOf = (s: DailySummary) => s.netPaidCents + s.netOpenCents + s.surchargeCents + s.otherChargeCents;

export function summarizeDays(rows: DailySalesRow[]): DailySummary {
    const read = rows.filter(isRead);
    const s: DailySummary = {
        days: read.length,
        unreadDays: rows.length - read.length,
        netPaidCents: 0, netOpenCents: 0, paidChecks: 0, openChecks: 0,
        surchargeCents: 0, serviceChargeCents: 0, gratuityCents: 0, otherChargeCents: 0,
        cashNetCents: 0, cashChecks: 0, cashDays: 0,
        cardNetCents: 0, cardChecks: 0,
        avgTicketCents: null, avgNetPerDayCents: null,
        openDays: []
    };
    for (const r of read) {
        s.netPaidCents += r.netPaidCents;
        s.netOpenCents += r.netOpenCents;
        s.paidChecks += r.paidChecks;
        s.openChecks += r.openChecks;
        s.surchargeCents += r.surchargeCents;
        s.serviceChargeCents += serviceChargeCents(r);
        s.gratuityCents += r.gratuityCents;
        s.otherChargeCents += r.otherChargeCents;
        const tender = splitTender(r);
        if (tender) {
            s.cashNetCents += tender.cashNetCents;
            s.cashChecks += tender.cashChecks;
            s.cardNetCents += tender.cardNetCents;
            s.cardChecks += tender.cardChecks;
            s.cashDays += 1;
        }
        if (r.openChecks > 0) s.openDays.push({ date: r.date, openChecks: r.openChecks, netOpenCents: r.netOpenCents });
    }
    s.openDays.sort((a, b) => (a.date < b.date ? 1 : -1));
    if (s.paidChecks > 0) s.avgTicketCents = Math.round(s.netPaidCents / s.paidChecks);
    if (s.days > 0) s.avgNetPerDayCents = Math.round(s.netPaidCents / s.days);
    return s;
}

/** Percent change from `previous` to `current`, one decimal; null when there is nothing to compare against. */
export function deltaPct(current: number, previous: number | null | undefined): number | null {
    if (previous === null || previous === undefined || previous === 0) return null;
    return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

/** 0 = Sunday … 6 = Saturday, as Date.getUTCDay() numbers a 'YYYY-MM-DD'. */
export function dayOfWeek(date: string): number {
    return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export type DowAverage = {
    /** 0 = Sunday … 6 = Saturday. */
    dow: number;
    /** How many read days of that weekday the window holds. */
    days: number;
    /** Average net sales of those days, rounded to the cent; null with no day. */
    avgNetCents: number | null;
    avgPaidChecks: number | null;
};

/**
 * Average net sales per weekday over the read days of the window. Seven
 * entries, Sunday first; the UI reorders them for the reader. A weekday with
 * no read day yet is null, never zero.
 */
export function weekdayAverages(rows: DailySalesRow[]): DowAverage[] {
    const sums = Array.from({ length: 7 }, () => ({ days: 0, net: 0, checks: 0 }));
    for (const r of rows) {
        if (!isRead(r)) continue;
        const b = sums[dayOfWeek(r.date)];
        b.days += 1;
        b.net += r.netPaidCents;
        b.checks += r.paidChecks;
    }
    return sums.map((b, dow) => ({
        dow,
        days: b.days,
        avgNetCents: b.days > 0 ? Math.round(b.net / b.days) : null,
        avgPaidChecks: b.days > 0 ? Math.round((b.checks / b.days) * 10) / 10 : null
    }));
}

export type ForecastDay = {
    date: string;
    dow: number;
    /** The weekday's average over the window; null when the window has no such weekday yet. */
    expectedCents: number | null;
    /** How many days the average rests on. */
    basisDays: number;
};

/**
 * The next `count` days after `after`, each with its weekday's average from
 * the window — a seasonal-naive forecast, which is the honest one for a
 * restaurant with a few weeks of history: a Saturday looks like the
 * Saturdays so far. `totalCents` sums the days that have an expectation.
 */
export function forecastDays(rows: DailySalesRow[], after: string, count = 7): { days: ForecastDay[]; totalCents: number; complete: boolean } {
    const avg = weekdayAverages(rows);
    const days: ForecastDay[] = [];
    let totalCents = 0;
    let complete = true;
    for (let i = 1; i <= count; i++) {
        const date = shiftDate(after, i);
        const dow = dayOfWeek(date);
        const expectedCents = avg[dow].avgNetCents;
        if (expectedCents === null) complete = false; else totalCents += expectedCents;
        days.push({ date, dow, expectedCents, basisDays: avg[dow].days });
    }
    return { days, totalCents, complete };
}
