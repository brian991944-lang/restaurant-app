'use server';

import { isAdminSession } from '@/lib/adminGuard';
import { lastToastBusinessDates } from '@/lib/pos/toastBusinessDate';
import { readToastDailySales } from '@/lib/pos/toastDailySales';
import prisma from '@/lib/prisma';
import { businessDateToUtcDate } from '@/lib/businessDay';
import { getRateConfig } from '@/app/actions/payroll';
import { clampRange, datesBetween, previousRange } from '@/lib/analytics/range';
import type { AnalyticsDailyResult } from '@/lib/analytics/daily';
import { priceLabor } from '@/lib/analytics/labor';
import type { AnalyticsLaborResult, LaborDayOut } from '@/lib/analytics/labor';

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
