/**
 * The payroll page's top-level tab, as it is written in the URL.
 *
 * This lives in lib, and NOT in PayrollTabs.tsx, for the same class of reason
 * that payrollWeek.ts is not in app/actions/payroll.ts — a file-level directive
 * decides who may call what. PayrollTabs.tsx is 'use client': every non-component
 * export of a client module becomes a client REFERENCE, and a server component
 * that calls one throws at render:
 *
 *   Attempted to call readTab() from the server but readTab is on the client.
 *
 * That took /en/payroll down in production (digest 563344333) while both
 * `next build` and `tsc --noEmit` passed, because it is a runtime boundary
 * violation rather than a type or compile error. A module with NO directive is
 * importable from both sides, which is what this needs to be: the server page
 * calls readTab to decide which tab to render, and the client bar imports the
 * type. Do not move it back, and do not re-export it from the client component.
 */

/** Which top-level section is showing. Mirrored in the URL as ?tab. */
export type PayrollTab = 'config' | 'reportes';

/**
 * Reports is the default, and anything unrecognised falls back to it.
 *
 * Shared so the server page and the tab bar agree on what a given URL means —
 * two copies of the fallback would be free to disagree, and the failure would
 * be a highlighted tab sitting above the other tab's content.
 */
export function readTab(raw: string | string[] | undefined): PayrollTab {
    const value = Array.isArray(raw) ? raw[0] : raw;
    return value === 'config' ? 'config' : 'reportes';
}
