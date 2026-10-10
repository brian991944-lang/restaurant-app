'use server';

import { revalidatePath } from 'next/cache';
import { isAdminSession } from '@/lib/adminGuard';
import { lastToastBusinessDates, toastBusinessDatesSince, TOAST_FIRST_BUSINESS_DATE } from '@/lib/pos/toastBusinessDate';
import { readToastDailySales, snapshotToastDailySalesCore, unreadToastDays } from '@/lib/pos/toastDailySales';
import { syncCloverSales } from '@/app/actions/clover';
import { isConnected as gbpConnected } from '@/lib/gbp/auth';
import { runFullSync as gbpSync } from '@/lib/gbp/sync';
import prisma from '@/lib/prisma';
import { businessDateToUtcDate, nyWallToUtc } from '@/lib/businessDay';
import { getRateConfig } from '@/app/actions/payroll';
import { clampRange, datesBetween, previousRange } from '@/lib/analytics/range';
import type { AnalyticsDailyResult } from '@/lib/analytics/daily';
import { priceLabor } from '@/lib/analytics/labor';
import type { AnalyticsLaborResult, LaborDayOut } from '@/lib/analytics/labor';
import { dishMentions, foldMetrics, reviewThemes, reviewsPerDay, summarizeReviews, sumMetrics } from '@/lib/analytics/reputation';
import type { AnalyticsReputationResult, ReviewLite } from '@/lib/analytics/reputation';
import type { SyncAnalyticsResult } from '@/lib/analytics/sync';
import { shiftDate } from '@/lib/pos/toastBusinessDate';

// Only server actions are exported from this file — no types, no constants.
// A 'use server' module registers every export as an action, and a
// re-exported type becomes a ReferenceError at module load that takes every
// action on the page down with it (see actions/toastDailySales.ts). Types
// live in src/lib/analytics and src/lib/pos and are imported from there.

/**
 * The stored daily figures for a window of Toast business days, oldest
 * first, plus the same-length window before it when that one exists in full
 * (null otherwise — the dashboard then shows no comparison rather than a
 * comparison against a partial period). Admin only: the figures are money.
 *
 * Nothing here calls Toast. A day never read comes back with computedAt
 * null, and the Ventas dashboard is where it gets read.
 */
export async function getAnalyticsDaily(from: string, to: string): Promise<AnalyticsDailyResult> {
    const today = lastToastBusinessDates(1)[0];
    const empty = { today, range: { from, to }, rows: [], previous: null };
    if (!(await isAdminSession())) return { success: false, error: 'Solo un administrador puede ver las ventas.', code: 'NOT_ADMIN', ...empty };
    const range = clampRange(from, to, today);
    if (!range) return { success: false, error: 'El período no es válido.', code: 'BAD_DATE', ...empty };
    try {
        const prev = previousRange(range);
        const [rows, prevRows] = await Promise.all([
            readToastDailySales(datesBetween(range.from, range.to)),
            prev ? readToastDailySales(datesBetween(prev.from, prev.to)) : Promise.resolve(null)
        ]);
        return { success: true, today, range, rows, previous: prev && prevRows ? { range: prev, rows: prevRows } : null };
    } catch (e) {
        console.error('Read analytics daily sales failed:', e instanceof Error ? e.message : e);
        return { success: false, error: 'No se pudieron leer las ventas guardadas.', code: 'READ_FAILED', ...empty };
    }
}

/**
 * Hours, wages and tips per day and per person for a window, priced as
 * Nómina prices them (src/lib/analytics/labor.ts). Punches carry the app's
 * business day (5 AM cutover), one hour apart from Toast's; a shift that
 * ends between 4 and 5 AM can land a day apart from its sales. Admin only.
 */
export async function getAnalyticsLabor(from: string, to: string): Promise<AnalyticsLaborResult> {
    const today = lastToastBusinessDates(1)[0];
    const rates = { serverRate: 0, busserRate: 0 };
    const empty = { today, range: { from, to }, days: [], people: [], totals: { hours: 0, wageCents: 0, unpricedHours: 0 }, rates };
    if (!(await isAdminSession())) return { success: false, error: 'Solo un administrador puede ver el personal.', code: 'NOT_ADMIN', ...empty };
    const range = clampRange(from, to, today);
    if (!range) return { success: false, error: 'El período no es válido.', code: 'BAD_DATE', ...empty };
    try {
        const start = businessDateToUtcDate(range.from);
        const end = businessDateToUtcDate(range.to);
        const dayKey = (d: Date) => d.toISOString().slice(0, 10);
        const [punches, tipEntries, tipDays, rateRows, cfg] = await Promise.all([
            prisma.payrollPunch.findMany({
                where: { businessDate: { gte: start, lte: end } },
                select: { businessDate: true, cloverEmployeeId: true, employeeName: true, hours: true }
            }),
            prisma.tipShiftEntry.findMany({
                where: { tipShift: { tipDay: { businessDate: { gte: start, lte: end } } } },
                select: { cloverEmployeeId: true, role: true, creditTips: true, serviceCharge: true, tipShift: { select: { tipDay: { select: { businessDate: true } } } } }
            }),
            prisma.tipDay.findMany({
                where: { businessDate: { gte: start, lte: end } },
                select: { businessDate: true, totalCreditTips: true, totalServiceCharge: true, totalCashTips: true }
            }),
            prisma.employeeRate.findMany({
                select: { cloverEmployeeId: true, employeeName: true, hourlyRate: true, department: true, cloverRole: true, isHidden: true }
            }),
            getRateConfig()
        ]);
        const priced = priceLabor(
            punches.map(p => ({ date: dayKey(p.businessDate), employeeId: p.cloverEmployeeId, employeeName: p.employeeName, hours: p.hours.toNumber() })),
            tipEntries.map(e => ({ date: dayKey(e.tipShift.tipDay.businessDate), employeeId: e.cloverEmployeeId, role: e.role })),
            rateRows.map(r => ({ employeeId: r.cloverEmployeeId, employeeName: r.employeeName, hourlyRate: r.hourlyRate === null ? null : r.hourlyRate.toNumber(), department: r.department, cloverRole: r.cloverRole, isHidden: r.isHidden })),
            { serverRate: cfg.serverRate, busserRate: cfg.busserRate }
        );
        const tipsByEmployee = new Map<string, number>();
        for (const e of tipEntries) {
            tipsByEmployee.set(e.cloverEmployeeId, (tipsByEmployee.get(e.cloverEmployeeId) ?? 0) + Math.round((e.creditTips.toNumber() + e.serviceCharge.toNumber()) * 100));
        }
        const tipsByDate = new Map(tipDays.map(d => [dayKey(d.businessDate), {
            creditTipsCents: Math.round(d.totalCreditTips.toNumber() * 100),
            serviceChargeCents: Math.round(d.totalServiceCharge.toNumber() * 100),
            cashTipsCents: Math.round(d.totalCashTips.toNumber() * 100)
        }]));
        const days: LaborDayOut[] = datesBetween(range.from, range.to).map(date => {
            const d = priced.days.get(date);
            return {
                date,
                hours: d?.hours ?? 0,
                wageCents: d?.wageCents ?? 0,
                unpricedHours: d?.unpricedHours ?? 0,
                people: d?.people ?? 0,
                byArea: d?.byArea ?? { SALON: { hours: 0, wageCents: 0 }, COCINA: { hours: 0, wageCents: 0 }, OTRO: { hours: 0, wageCents: 0 } },
                tips: tipsByDate.get(date) ?? null
            };
        });
        const people = priced.people.map(p => ({ ...p, tipsCents: p.employeeId ? tipsByEmployee.get(p.employeeId) ?? 0 : 0 }));
        return { success: true, today, range, days, people, totals: priced.totals, rates: { serverRate: cfg.serverRate, busserRate: cfg.busserRate } };
    } catch (e) {
        console.error('Read analytics labor failed:', e instanceof Error ? e.message : e);
        return { success: false, error: 'No se pudieron leer las horas y la nómina.', code: 'READ_FAILED', ...empty };
    }
}

/** The New York calendar day an instant falls on, 'YYYY-MM-DD'. Reviews are dated the way Google shows them, not by the 4 AM business day. */
const nyCalendarDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

/** How many of the window's reviews come back with their text; the rest are counted and bucketed only. */
const LATEST_REVIEWS = 40;
const COMMENT_MAX = 400;

/**
 * Google reviews and Business Profile performance for a window: rating and
 * volume, what the reviews mention, the newest ones with their text, and the
 * profile's impressions and actions per day. Admin only; nothing here calls
 * Google — /api/gbp/sync fills the tables once a day.
 */
export async function getAnalyticsReputation(from: string, to: string): Promise<AnalyticsReputationResult> {
    const today = lastToastBusinessDates(1)[0];
    const noSummary = summarizeReviews([]);
    const noMetrics = sumMetrics([]);
    const empty = {
        today, range: { from, to }, headline: null, summary: noSummary, previous: { summary: noSummary, metrics: noMetrics },
        perDay: [], themes: [], dishes: [], latest: [], metrics: [], metricTotals: noMetrics, lastMetricDate: null
    };
    if (!(await isAdminSession())) return { success: false, error: 'Solo un administrador puede ver la reputación.', code: 'NOT_ADMIN', ...empty };
    const range = clampRange(from, to, today);
    if (!range) return { success: false, error: 'El período no es válido.', code: 'BAD_DATE', ...empty };
    try {
        const dates = datesBetween(range.from, range.to);
        const prevTo = shiftDate(range.from, -1);
        const prevFrom = shiftDate(prevTo, -(dates.length - 1));
        const prevDates = datesBetween(prevFrom, prevTo);
        const dateCol = (d: string) => new Date(`${d}T00:00:00.000Z`);
        const toLite = (r: { id: string; createTime: Date; starRating: number; reviewerName: string | null; isAnonymous: boolean; comment: string | null; replyComment: string | null }): ReviewLite => ({
            id: r.id,
            date: nyCalendarDate(r.createTime),
            createdAt: r.createTime.toISOString(),
            stars: r.starRating,
            reviewer: r.isAnonymous ? null : r.reviewerName,
            comment: r.comment,
            replied: r.replyComment !== null && r.replyComment.trim().length > 0
        });
        const reviewSelect = { id: true, createTime: true, starRating: true, reviewerName: true, isAnonymous: true, comment: true, replyComment: true } as const;
        const [reviews, prevReviews, metricRows, prevMetricRows, snapshot, lastMetric] = await Promise.all([
            prisma.gbpReview.findMany({
                where: { createTime: { gte: nyWallToUtc(range.from, 0), lt: nyWallToUtc(shiftDate(range.to, 1), 0) } },
                orderBy: { createTime: 'desc' }, select: reviewSelect
            }),
            prisma.gbpReview.findMany({
                where: { createTime: { gte: nyWallToUtc(prevFrom, 0), lt: nyWallToUtc(range.from, 0) } },
                select: reviewSelect
            }),
            prisma.gbpDailyMetric.findMany({ where: { date: { gte: dateCol(range.from), lte: dateCol(range.to) } }, select: { date: true, metric: true, value: true } }),
            prisma.gbpDailyMetric.findMany({ where: { date: { gte: dateCol(prevFrom), lte: dateCol(prevTo) } }, select: { date: true, metric: true, value: true } }),
            prisma.gbpRatingSnapshot.findFirst({ orderBy: { date: 'desc' } }),
            prisma.gbpDailyMetric.findFirst({ orderBy: { date: 'desc' }, select: { date: true } })
        ]);
        const lite = reviews.map(toLite);
        const metrics = foldMetrics(metricRows.map(m => ({ date: m.date.toISOString().slice(0, 10), metric: m.metric, value: m.value })), dates);
        const prevMetrics = foldMetrics(prevMetricRows.map(m => ({ date: m.date.toISOString().slice(0, 10), metric: m.metric, value: m.value })), prevDates);
        return {
            success: true,
            today,
            range,
            headline: snapshot ? { rating: Math.round(snapshot.averageRating * 10) / 10, total: snapshot.totalReviews, date: snapshot.date.toISOString().slice(0, 10) } : null,
            summary: summarizeReviews(lite),
            previous: { summary: summarizeReviews(prevReviews.map(toLite)), metrics: sumMetrics(prevMetrics) },
            perDay: reviewsPerDay(lite, dates),
            themes: reviewThemes(lite),
            dishes: dishMentions(lite),
            latest: lite.slice(0, LATEST_REVIEWS).map(r => ({ ...r, comment: r.comment && r.comment.length > COMMENT_MAX ? `${r.comment.slice(0, COMMENT_MAX)}…` : r.comment })),
            metrics,
            metricTotals: sumMetrics(metrics),
            lastMetricDate: lastMetric ? lastMetric.date.toISOString().slice(0, 10) : null
        };
    } catch (e) {
        console.error('Read analytics reputation failed:', e instanceof Error ? e.message : e);
        return { success: false, error: 'No se pudieron leer las reseñas.', code: 'READ_FAILED', ...empty };
    }
}

/** Toast days one Sync reads at most: today and yesterday, then the oldest days still unread. */
const SYNC_TOAST_DAYS = 6;
/** Wall-clock budget before the action stops starting new steps (Hobby functions stop at 60 s). */
const SYNC_BUDGET_MS = 38_000;

/**
 * The one button: read Toast for today and yesterday plus up to four of the
 * oldest days still missing figures or items (press again for the rest),
 * then Google Business Profile (new reviews and the last week of metrics),
 * then the Clover item audit. Each step reports on its own; a failure in
 * one never hides the others. Admin only.
 */
export async function syncAnalytics(): Promise<SyncAnalyticsResult> {
    const startedAt = Date.now();
    const elapsed = () => Date.now() - startedAt;
    const today = lastToastBusinessDates(1)[0];
    const result: SyncAnalyticsResult = {
        success: false,
        toast: { read: [], skipped: [], remaining: 0, error: null },
        google: { ran: false, reviews: 0, metricDays: 0, error: null },
        clover: { ran: false, items: 0, error: null },
        tookMs: 0
    };
    if (!(await isAdminSession())) return { ...result, code: 'NOT_ADMIN', tookMs: elapsed() };

    // ── Toast ──
    try {
        const recent = lastToastBusinessDates(2);
        const unread = (await unreadToastDays(toastBusinessDatesSince(TOAST_FIRST_BUSINESS_DATE))).filter(d => !recent.includes(d));
        const dates = [...recent, ...unread.slice(0, SYNC_TOAST_DAYS - recent.length)];
        result.toast.remaining = Math.max(0, unread.length - (dates.length - recent.length));
        for (const date of dates) {
            if (elapsed() > SYNC_BUDGET_MS) { result.toast.remaining += 1; continue; }
            const [report] = await snapshotToastDailySalesCore([date]);
            if (report.skipped) result.toast.skipped.push({ date, code: report.skippedCode ?? 'TOAST_FAILED', status: report.skippedStatus });
            else result.toast.read.push(date);
        }
    } catch (e) {
        console.error('Sync Toast failed:', e instanceof Error ? e.message : e);
        result.toast.error = 'FAILED';
    }

    // ── Google Business Profile ──
    if (elapsed() <= SYNC_BUDGET_MS) {
        try {
            if (await gbpConnected()) {
                const r = await gbpSync({ maxPages: 2, metricDays: 7 });
                result.google = { ran: true, reviews: r.reviews.upserted, metricDays: r.metrics?.days ?? 0, error: null };
            } else {
                result.google.error = 'NOT_CONNECTED';
            }
        } catch (e) {
            console.error('Sync Google failed:', e instanceof Error ? e.message : e);
            result.google = { ran: true, reviews: 0, metricDays: 0, error: 'FAILED' };
        }
    } else {
        result.google.error = 'TIME';
    }

    // ── Clover item audit ──
    if (elapsed() <= SYNC_BUDGET_MS) {
        try {
            const r = await syncCloverSales();
            result.clover = r.success ? { ran: true, items: r.count ?? 0, error: null } : { ran: true, items: 0, error: 'FAILED' };
        } catch (e) {
            // requireCloverEnv throws when the credentials are not configured.
            console.error('Sync Clover failed:', e instanceof Error ? e.message : e);
            result.clover = { ran: true, items: 0, error: 'FAILED' };
        }
    } else {
        result.clover.error = 'TIME';
    }

    revalidatePath('/[locale]/analytics/[view]', 'page');
    return { ...result, success: true, today, tookMs: elapsed() };
}
