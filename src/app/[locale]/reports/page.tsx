import { getTranslations } from 'next-intl/server';
import { getPayrollSpend } from '@/app/actions/payroll';
import { getUploadLog } from '@/app/actions/reports';
import { lastCompleteWeekEnding, resolveWeekRange } from '@/lib/payrollWeek';
import { readReportsTab, readExpenseTab } from '@/lib/reportsTab';
import ReportsWeekPicker from './ReportsWeekPicker';
import UploadLogTable from './UploadLogTable';
import PayrollSpendReport from '../payroll/PayrollSpendReport';
import CollapsibleSection from '../payroll/CollapsibleSection';
import TimesheetImporter from '../payroll/TimesheetImporter';
import AdpLiabilityImporter from '../payroll/AdpLiabilityImporter';
import AdpFeeImporter from '../payroll/AdpFeeImporter';

/**
 * Reports — expenses, and a record of what has been uploaded.
 *
 * ?tab still selects the view; the SIDEBAR sets it now instead of a bar on this
 * page. Nothing about the reading changed, which is the point — the parameter is
 * the contract, and moving the control that writes it did not touch the contract.
 * A hand-typed or bookmarked ?tab still works, and an unrecognised one still
 * falls back through readReportsTab.
 *
 * readReportsTab and readExpenseTab come from @/lib/reportsTab, which carries no
 * 'use client' directive precisely so this server component can call them — and
 * now so the client Sidebar can call the same function to decide which child to
 * highlight. See that file's header before moving either.
 */
export default async function ReportsPage({
    searchParams,
}: {
    searchParams: Promise<{ week?: string | string[]; tab?: string | string[]; exp?: string | string[] }>;
}) {
    const t = await getTranslations('Reports');

    const { week: rawWeek, tab: rawTab, exp: rawExp } = await searchParams;
    const requested = Array.isArray(rawWeek) ? rawWeek[0] : rawWeek;
    const tab = readReportsTab(rawTab);
    const expense = readExpenseTab(rawExp);

    const week = resolveWeekRange(requested);

    // Both fetched regardless of tab: they are two small queries, and awaiting
    // them together keeps a tab switch from paying a fresh round trip. Only the
    // selected tab is RENDERED.
    const [spend, uploads] = await Promise.all([
        getPayrollSpend(requested),
        getUploadLog(),
    ]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', maxWidth: '1400px', margin: '0 auto', padding: '1.5rem' }} data-testid="reports-page">
            <div>
                <h1 style={{ fontSize: '2.5rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                    {t('title')}
                </h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem', margin: 0 }}>
                    {t('subtitle')}
                </p>
            </div>

            {/* ONLY the selected tab is rendered, never all of them with the
                others hidden — the same rule the payroll page follows. Each tab
                is tested explicitly rather than by a final `else`, so a third tab
                cannot be swept into the second one's branch. */}
            {tab === 'gastos' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }} data-testid="reports-gastos">
                    {/* No sub-tab bar: payroll is the only expense, and the
                        sidebar links straight to it. The ?exp parameter and its
                        reader are kept so a second category is a new branch here
                        rather than a new mechanism. */}
                    {expense === 'nomina' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }} data-testid="expense-nomina">
                            <div className="glass-panel" style={{ padding: '1.5rem' }}>
                                <ReportsWeekPicker
                                    weekStart={week.start}
                                    weekEnding={week.end}
                                    maxSelectableDate={lastCompleteWeekEnding()}
                                />
                            </div>

                            {/* The same component the payroll page mounts, given the
                                same shape of prop. One definition of what a week
                                cost, rendered in two places. */}
                            <PayrollSpendReport spend={spend} />
                        </div>
                    )}
                </div>
            )}

            {tab === 'archivos' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }} data-testid="reports-archivos">
                    {/* The uploaders sit above the table but COLLAPSED, so the tab
                        opens on the table rather than on two upload panels pushing
                        it below the fold. The table is why you came to this tab;
                        the uploaders are what you do about what it tells you.

                        Collapsed also means unmounted — CollapsibleSection renders
                        `{open && children}` — so a closed importer holds no stale
                        parse result from a file you looked at and thought better of.

                        Same components the payroll page mounts, with no props and
                        no shared module state, so the two mount points are wholly
                        independent instances. */}
                    <CollapsibleSection title={t('upload_import_timesheet')} testId="reports-timesheet-upload">
                        <TimesheetImporter />
                    </CollapsibleSection>

                    <CollapsibleSection title={t('upload_import_adp')} testId="reports-adp-upload">
                        <AdpLiabilityImporter />
                    </CollapsibleSection>

                    {/* The fee invoice is a third document, not part of the
                        Liability import: it arrives days later and one file can
                        cover several periods. Its own section for that reason. */}
                    <CollapsibleSection title={t('upload_import_adp_fee')} testId="reports-adpfee-upload">
                        <AdpFeeImporter />
                    </CollapsibleSection>

                    <UploadLogTable rows={uploads} />
                </div>
            )}
        </div>
    );
}
