import { getTranslations } from 'next-intl/server';
import { getPayrollWeek, getEmployeeConfigs, getAdvances } from '@/app/actions/payroll';
import { lastCompleteWeekEnding, resolveWeekRange } from '@/lib/payrollWeek';
import RateConfigPanel from './RateConfigPanel';
import EmployeeConfigPanel from './EmployeeConfigPanel';
import AdvancesPanel from './AdvancesPanel';
import PayrollWeekTable from './PayrollWeekTable';
import PayrollTabs from './PayrollTabs';
import { readTab } from '@/lib/payrollTab';
import CollapsibleSection from './CollapsibleSection';
import TimesheetImporter from './TimesheetImporter';

export default async function PayrollPage({
    searchParams
}: {
    searchParams: Promise<{ week?: string | string[]; tab?: string | string[] }>;
}) {
    const t = await getTranslations('Payroll');

    const { week: rawWeek, tab: rawTab } = await searchParams;
    const requested = Array.isArray(rawWeek) ? rawWeek[0] : rawWeek;
    const tab = readTab(rawTab);

    // The week is resolved HERE as well as inside getPayrollWeek, from the same
    // helper, so the configuration list can be scoped to the week on screen
    // without waiting on the weekly view first. Both queries still run in
    // parallel; the alternative was a waterfall for one string.
    const week = resolveWeekRange(requested);

    const [view, configs, advances] = await Promise.all([
        getPayrollWeek(requested),
        getEmployeeConfigs(week),
        getAdvances(),
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

            <PayrollTabs active={tab} />

            {/* Only the selected tab is rendered, rather than both with one
                hidden. A hidden PayrollWeekTable would still mount, seed a
                draft per row and hold unsaved edits nobody can see. */}
            {tab === 'config' ? (
                <>
                    <RateConfigPanel config={view.rateConfig} />
                    <EmployeeConfigPanel configs={configs} />
                    {/* The picker offers the same people the panel above lists,
                        so an advance cannot be opened against somebody who is
                        not on the screen the rate would have to be set on. */}
                    <AdvancesPanel
                        advances={advances}
                        people={configs.map(c => ({
                            cloverEmployeeId: c.cloverEmployeeId,
                            employeeName: c.employeeName,
                        }))}
                        defaultWeekEnding={lastCompleteWeekEnding()}
                    />
                </>
            ) : (
                <>
                    {/* The bound is the SUNDAY ending the last complete week, so every
                        day of every finished week is clickable while the week still in
                        progress stays out of reach. Computed on the server: it depends
                        on the BUSINESS date, and a client `new Date()` would offer a
                        week the server considers unfinished during the pre-cutover hours. */}
                    <PayrollWeekTable view={view} maxSelectableDate={lastCompleteWeekEnding()} />

                    <CollapsibleSection title={t('importer_section')}>
                        <TimesheetImporter />
                    </CollapsibleSection>
                </>
            )}
        </div>
    );
}
