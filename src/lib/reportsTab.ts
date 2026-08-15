/**
 * The Reports page's tabs, as they are written in the URL.
 *
 * This lives in lib, and NOT in ReportsTabs.tsx, for exactly the reason
 * lib/payrollTab.ts spells out: a file-level directive decides who may call
 * what. ReportsTabs.tsx is 'use client', every non-component export of a client
 * module becomes a client REFERENCE, and a server component that calls one
 * throws at render:
 *
 *   Attempted to call readTab() from the server but readTab is on the client.
 *
 * That took /en/payroll down in production (digest 563344333) while both
 * `next build` and `tsc --noEmit` passed, because it is a runtime boundary
 * violation rather than a type or compile error. A module with NO directive is
 * importable from both sides, which is what this needs to be: the server page
 * calls the readers to decide what to render, and the client bars import the
 * types. Do not move these into the component, and do not re-export them from
 * it.
 */

// ─────────────────────────────────────────────────────────────
// Top level
// ─────────────────────────────────────────────────────────────

/** Which top-level section is showing. Mirrored in the URL as ?tab. */
export type ReportsTab = 'gastos' | 'archivos';

/** Every tab, in the order the bar shows them. The bar maps over this rather
 *  than repeating the list, so a tab cannot exist in the type and be missing
 *  from the UI. */
export const REPORTS_TABS = ['gastos', 'archivos'] as const;

/** Expenses is the default, and anything unrecognised falls back to it. */
export const DEFAULT_REPORTS_TAB: ReportsTab = 'gastos';

/**
 * Which tab a `?tab=` value addresses.
 *
 * An allow-list rather than a chain of `===` comparisons: a chain has to be
 * extended in lockstep with the type, and forgetting silently routes the new tab
 * to the default instead of failing.
 */
export function readReportsTab(raw: string | string[] | undefined): ReportsTab {
    const value = Array.isArray(raw) ? raw[0] : raw;
    return REPORTS_TABS.includes(value as ReportsTab) ? (value as ReportsTab) : DEFAULT_REPORTS_TAB;
}

// ─────────────────────────────────────────────────────────────
// Expenses sub-tabs
// ─────────────────────────────────────────────────────────────

/**
 * Which expense the Gastos tab is showing. Mirrored in the URL as ?exp.
 *
 * A separate parameter from ?tab so the two levels cannot collide — switching
 * the top-level tab must not silently reinterpret the sub-tab's value as one of
 * its own.
 *
 * There is one member today. It is a union and an allow-list rather than a bare
 * constant because payroll is the first expense here, not the only one there
 * will ever be — but nothing is added until there is a real report to add.
 */
export type ExpenseTab = 'nomina';

export const EXPENSE_TABS = ['nomina'] as const;

export const DEFAULT_EXPENSE_TAB: ExpenseTab = 'nomina';

export function readExpenseTab(raw: string | string[] | undefined): ExpenseTab {
    const value = Array.isArray(raw) ? raw[0] : raw;
    return EXPENSE_TABS.includes(value as ExpenseTab) ? (value as ExpenseTab) : DEFAULT_EXPENSE_TAB;
}
