import { getTranslations } from 'next-intl/server';
import { getPayrollSpend } from '@/app/actions/payroll';
import { getUploadLog } from '@/app/actions/reports';
import { lastCompleteWeekEnding, resolveWeekRange } from '@/lib/payrollWeek';
import { readReportsTab, readExpenseTab } from '@/lib/reportsTab';
import ReportsTabs from './ReportsTabs';
import ExpenseTabs from './ExpenseTabs';
import ReportsWeekPicker from './ReportsWeekPicker';
import UploadLogTable from './UploadLogTable';
import PayrollSpendReport from '../payroll/PayrollSpendReport';

/**
 * Reports — expenses, and a record of what has been uploaded.
 *
 * readReportsTab and readExpenseTab come from @/lib/reportsTab, which carries no
 * 'use client' directive precisely so this server component can call them. See
 * that file's header before moving either.
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

            <ReportsTabs active={tab} />

            {/* ONLY the selected tab is rendered, never all of them with the
                others hidden — the same rule the payroll page follows. Each tab
                is tested explicitly rather than by a final `else`, so a third tab
                cannot be swept into the second one's branch. */}
            {tab === 'gastos' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }} data-testid="reports-gastos">
                    <ExpenseTabs active={expense} />

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
                <div data-testid="reports-archivos">
                    <UploadLogTable rows={uploads} />
                </div>
            )}
        </div>
    );
}
