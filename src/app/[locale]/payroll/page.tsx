import { getTranslations } from 'next-intl/server';
import { getPayrollWeek, getEmployeeConfigs } from '@/app/actions/payroll';
import { lastCompleteWeekEnding } from '@/lib/payrollWeek';
import RateConfigPanel from './RateConfigPanel';
import EmployeeConfigPanel from './EmployeeConfigPanel';
import PayrollWeekTable from './PayrollWeekTable';
import CollapsibleSection from './CollapsibleSection';
import TimesheetImporter from './TimesheetImporter';

export default async function PayrollPage({
    searchParams
}: {
    searchParams: Promise<{ week?: string | string[] }>;
}) {
    const t = await getTranslations('Payroll');

    const { week: rawWeek } = await searchParams;
    // Anything unusable falls back to the most recent complete week rather than
    // erroring: a hand-edited URL should land somewhere sensible.
    const requested = Array.isArray(rawWeek) ? rawWeek[0] : rawWeek;
    const [view, configs] = await Promise.all([
        getPayrollWeek(requested),
        getEmployeeConfigs(),
    ]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', maxWidth: '1400px', margin: '0 auto', padding: '1.5rem' }}>
            <div>
                <h1 style={{ fontSize: '2.5rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                    {t('title')}
                </h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem', margin: 0 }}>
                    {t('subtitle')}
                </p>
            </div>

            <RateConfigPanel config={view.rateConfig} />

            <EmployeeConfigPanel configs={configs} />

            {/* The bound is the SUNDAY ending the last complete week, so every
                day of every finished week is clickable while the week still in
                progress stays out of reach. Computed on the server: it depends
                on the BUSINESS date, and a client `new Date()` would offer a
                week the server considers unfinished during the pre-cutover hours. */}
            <PayrollWeekTable view={view} maxSelectableDate={lastCompleteWeekEnding()} />

            <CollapsibleSection title={t('importer_section')}>
                <TimesheetImporter />
            </CollapsibleSection>
        </div>
    );
}
