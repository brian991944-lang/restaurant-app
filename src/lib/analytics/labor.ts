/**
 * Labor cost per day and per person for the Personal dashboard, priced the
 * way Nómina prices a week (src/app/actions/payroll.ts, getPayrollWeek):
 *
 *   1. A person's own configured hourly rate prices every hour they worked.
 *   2. Otherwise each DAY is priced at the role the tip sheet recorded that
 *      day — busser or server — falling back to the person's dominant role
 *      over the window when the day carried no tips.
 *   3. No configured rate and no role anywhere → the hours are UNPRICED and
 *      reported as such, never priced at a guess.
 *
 * Department comes from resolveDepartment (manual override, then the cached
 * Wait Staff role, then tip evidence). Hidden people (EmployeeRate.isHidden)
 * are left out entirely: that flag is how Nómina drops owners and
 * back-office rows from payroll, and this dashboard is payroll seen by day.
 *
 * Pure: the action gathers the rows, this prices them. Money in integer
 * cents, hours as the decimal the time clock exported.
 */

import { resolveDepartment } from '@/lib/department';

// Prisma's enums are string unions at runtime; spelling them out here keeps
// this module free of @prisma/client so the dashboard can import its types
// without pulling the client into the browser bundle.
export type TipRole = 'MESERO' | 'BUSSER';
export type Dept = 'SALON' | 'COCINA';

export type LaborPunch = {
    /** 'YYYY-MM-DD' — the app's business day (5 AM cutover). */
    date: string;
    employeeId: string | null;
    employeeName: string;
    hours: number;
};

export type LaborTipEntry = {
    date: string;
    employeeId: string;
    role: TipRole;
};

export type LaborRateRow = {
    employeeId: string;
    employeeName: string;
    hourlyRate: number | null;
    department: Dept | null;
    cloverRole: string | null;
    isHidden: boolean;
};

export type LaborRates = { serverRate: number; busserRate: number };

/** Which bucket a person's hours land in. OTRO is "no department resolved". */
export type LaborArea = 'SALON' | 'COCINA' | 'OTRO';

export type LaborDay = {
    date: string;
    hours: number;
    /** Priced hours only. */
    wageCents: number;
    unpricedHours: number;
    /** How many different people punched that day. */
    people: number;
    byArea: Record<LaborArea, { hours: number; wageCents: number }>;
};

export type LaborPerson = {
    key: string;
    employeeId: string | null;
    name: string;
    area: LaborArea;
    /** The role that priced most of their hours, when a role priced them. */
    role: TipRole | null;
    days: number;
    hours: number;
    wageCents: number;
    unpricedHours: number;
    /** Their configured rate, or the role rate, or null when nothing priced them. */
    rateUsed: number | null;
    /** True when their rate came from Nómina's own configuration rather than a role. */
    configured: boolean;
};

export type LaborResult = {
    /** One entry per date that had a punch, keyed by date. */
    days: Map<string, LaborDay>;
    people: LaborPerson[];
    totals: { hours: number; wageCents: number; unpricedHours: number };
};

const rateForRole = (role: TipRole, rates: LaborRates) => (role === 'BUSSER' ? rates.busserRate : rates.serverRate);

/** Whichever role appears on more entries; ties go to MESERO, as in Nómina. */
function dominant(counts: Map<TipRole, number> | undefined): TipRole | null {
    if (!counts || counts.size === 0) return null;
    const mesero = counts.get('MESERO') ?? 0;
    const busser = counts.get('BUSSER') ?? 0;
    return busser > mesero ? 'BUSSER' : 'MESERO';
}

const emptyAreas = (): LaborDay['byArea'] => ({ SALON: { hours: 0, wageCents: 0 }, COCINA: { hours: 0, wageCents: 0 }, OTRO: { hours: 0, wageCents: 0 } });

export function priceLabor(punches: LaborPunch[], tipEntries: LaborTipEntry[], rateRows: LaborRateRow[], rates: LaborRates): LaborResult {
    const configuredById = new Map(rateRows.map(r => [r.employeeId, r]));

    // Roles per person per day, and over the whole window, from the tip sheet.
    const rolesByDay = new Map<string, Map<string, Map<TipRole, number>>>();
    const rolesAll = new Map<string, Map<TipRole, number>>();
    for (const e of tipEntries) {
        if (!rolesByDay.has(e.employeeId)) rolesByDay.set(e.employeeId, new Map());
        const days = rolesByDay.get(e.employeeId)!;
        if (!days.has(e.date)) days.set(e.date, new Map());
        const day = days.get(e.date)!;
        day.set(e.role, (day.get(e.role) ?? 0) + 1);
        if (!rolesAll.has(e.employeeId)) rolesAll.set(e.employeeId, new Map());
        const all = rolesAll.get(e.employeeId)!;
        all.set(e.role, (all.get(e.role) ?? 0) + 1);
    }

    const days = new Map<string, LaborDay>();
    const peopleDays = new Map<string, Set<string>>();
    const people = new Map<string, LaborPerson & { roleHours: Map<TipRole, number> }>();
    const totals = { hours: 0, wageCents: 0, unpricedHours: 0 };

    for (const p of punches) {
        const key = p.employeeId ?? `name:${p.employeeName}`;
        const configured = p.employeeId ? configuredById.get(p.employeeId) : undefined;
        if (configured?.isHidden) continue;

        const sawTip = !!(p.employeeId && rolesAll.has(p.employeeId));
        const dept = resolveDepartment(configured, sawTip);
        const area: LaborArea = dept === 'SALON' ? 'SALON' : dept === 'COCINA' ? 'COCINA' : 'OTRO';

        // The rate for THIS day, by the same ladder Nómina climbs.
        let rate: number | null = null;
        let role: TipRole | null = null;
        if (configured?.hourlyRate != null) {
            rate = configured.hourlyRate;
        } else if (p.employeeId) {
            role = dominant(rolesByDay.get(p.employeeId)?.get(p.date)) ?? dominant(rolesAll.get(p.employeeId));
            if (role) rate = rateForRole(role, rates);
        }
        // Summed in cents per punch; Nómina rounds once per week, so a week
        // here can differ from Nómina's by a cent or two. Nobody is paid from
        // this page.
        const wageCents = rate !== null ? Math.round(p.hours * rate * 100) : 0;

        if (!days.has(p.date)) days.set(p.date, { date: p.date, hours: 0, wageCents: 0, unpricedHours: 0, people: 0, byArea: emptyAreas() });
        const day = days.get(p.date)!;
        day.hours += p.hours;
        day.wageCents += wageCents;
        if (rate === null) day.unpricedHours += p.hours;
        day.byArea[area].hours += p.hours;
        day.byArea[area].wageCents += wageCents;
        if (!peopleDays.has(p.date)) peopleDays.set(p.date, new Set());
        peopleDays.get(p.date)!.add(key);

        if (!people.has(key)) {
            people.set(key, {
                key, employeeId: p.employeeId, name: configured?.employeeName ?? p.employeeName, area, role: null,
                days: 0, hours: 0, wageCents: 0, unpricedHours: 0,
                rateUsed: configured?.hourlyRate ?? null, configured: configured?.hourlyRate != null,
                roleHours: new Map()
            });
        }
        const person = people.get(key)!;
        person.hours += p.hours;
        person.wageCents += wageCents;
        if (rate === null) person.unpricedHours += p.hours;
        if (role) person.roleHours.set(role, (person.roleHours.get(role) ?? 0) + p.hours);

        totals.hours += p.hours;
        totals.wageCents += wageCents;
        if (rate === null) totals.unpricedHours += p.hours;
    }

    for (const [date, set] of peopleDays) days.get(date)!.people = set.size;

    // Days worked per person, and the role that priced most of their hours.
    const daysByPerson = new Map<string, Set<string>>();
    for (const p of punches) {
        const key = p.employeeId ?? `name:${p.employeeName}`;
        if (!people.has(key)) continue;
        if (!daysByPerson.has(key)) daysByPerson.set(key, new Set());
        daysByPerson.get(key)!.add(p.date);
    }
    const list: LaborPerson[] = [...people.values()].map(({ roleHours, ...person }) => {
        let role: TipRole | null = null;
        let best = 0;
        for (const [r, h] of roleHours) if (h > best) { best = h; role = r; }
        return {
            ...person,
            role,
            days: daysByPerson.get(person.key)?.size ?? 0,
            rateUsed: person.configured ? person.rateUsed : role ? rateForRole(role, rates) : null
        };
    });
    list.sort((a, b) => b.wageCents - a.wageCents || b.hours - a.hours);

    return { days, people: list, totals };
}

/** One day of the window as the action returns it: priced hours plus the tip sheet's totals. */
export type LaborDayOut = {
    date: string;
    hours: number;
    wageCents: number;
    unpricedHours: number;
    people: number;
    byArea: Record<LaborArea, { hours: number; wageCents: number }>;
    /** From TipDay for that date; null when no tip day was filled. */
    tips: { creditTipsCents: number; serviceChargeCents: number; cashTipsCents: number } | null;
};

/**
 * The labor-cost share of net sales the dashboard draws its reference line
 * at. A full-service restaurant is usually run to 28–32%; this is the round
 * figure in the middle, not a target anyone set in the app yet.
 */
export const LABOR_TARGET_PCT = 30;

/** What actions/analytics.ts answers for the Personal dashboard. Declared here because a 'use server' module may export only actions. */
export type AnalyticsLaborResult = {
    success: boolean;
    error?: string;
    code?: 'NOT_ADMIN' | 'BAD_DATE' | 'READ_FAILED';
    today: string;
    range: { from: string; to: string };
    /** One per date of the window, oldest first; a day with no punch has zero hours. */
    days: LaborDayOut[];
    /** Priced people plus what the tip sheet gave each of them (card tips and service charge) in the window. */
    people: (LaborPerson & { tipsCents: number })[];
    totals: { hours: number; wageCents: number; unpricedHours: number };
    /** The tipped rates in force, for the footnote. */
    rates: LaborRates;
};
