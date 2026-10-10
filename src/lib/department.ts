import { Department } from '@prisma/client';

/**
 * Department resolution, shared by the payroll actions and the timesheets view.
 *
 * This lives in lib rather than in app/actions/payroll.ts because that file is
 * 'use server': it may only export async functions, and this is a sync helper.
 * No directive here, so both sides can import it.
 */

/** The one Clover role that carries a department. Nothing else does. */
export const WAIT_STAFF_ROLE = 'wait staff';

/**
 * Which department a person belongs to, most trustworthy source first.
 *
 * Still database-only — cloverRole is the CACHED role, read from the row like
 * everything else here. Nothing in this function reaches Clover, so a payroll
 * screen still renders during a Clover outage.
 *
 * 1. department, the manual override. A human said so; nothing outranks that.
 * 2. The cached Clover role, but ONLY Wait Staff, which means SALON. Every other
 *    role resolves nothing and FALLS THROUGH to the next tier — it does not
 *    short-circuit to null. "Employee" is the merchant's generic role and is on
 *    40 of 56 rows; "Accountant", "Manager" and "admin" are back-office. Reading
 *    any of them as a department was the old "not Wait Staff means kitchen"
 *    rule, which put the accountants in the kitchen report. A role that carries
 *    no information must not outrank the tip evidence below it either.
 * 3. A tip entry this week. The tip sheet only ever records MESERO and BUSSER,
 *    so having one is proof of salon — but its absence proves nothing, which is
 *    why this is the last resort rather than a reason to guess kitchen.
 * 4. Null, reported as SIN_DEPARTAMENTO rather than assumed.
 *
 * COCINA is therefore never inferred: it is only ever the manual override.
 *
 * Shared with syncCloverRoles so the summary it reports after a refresh is the
 * same resolution the payroll screen will actually show.
 */
export function resolveDepartment(
    configured: { department: Department | null; cloverRole: string | null } | undefined | null,
    sawTip: boolean
): Department | null {
    if (configured?.department) return configured.department;

    if (configured?.cloverRole?.trim().toLowerCase() === WAIT_STAFF_ROLE) return Department.SALON;

    return sawTip ? Department.SALON : null;
}
