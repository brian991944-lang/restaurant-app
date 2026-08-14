import { getTranslations } from 'next-intl/server';
import { getPayrollWeek, getEmployeeConfigs, getAdvances, getAdpRuns } from '@/app/actions/payroll';
import { lastCompleteWeekEnding, resolveWeekRange } from '@/lib/payrollWeek';
import RateConfigPanel from './RateConfigPanel';
import EmployeeConfigPanel from './EmployeeConfigPanel';
import AdvancesPanel from './AdvancesPanel';
import PayrollWeekTable from './PayrollWeekTable';
import PayrollTabs from './PayrollTabs';
import { readTab } from '@/lib/payrollTab';
import CollapsibleSection from './CollapsibleSection';
import TimesheetImporter from './TimesheetImporter';
import AdpLiabilityImporter from './AdpLiabilityImporter';
import AdpRunsList from './AdpRunsList';

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

    const [view, configs, advances, adpRuns] = await Promise.all([
        getPayrollWeek(requested),
        getEmployeeConfigs(week),
        getAdvances(),
        getAdpRuns(),
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

            {/* ONLY the selected tab is rendered, never all of them with the
                others hidden. A hidden PayrollWeekTable would still mount, seed
                a draft per row and hold unsaved edits nobody can see.

                Each tab is tested explicitly rather than by a final `else`.
                While there were two tabs a binary ternary agreed with readTab by
                coincidence; with three, "not config" would have swept adelantos
                into the reports branch — a highlighted tab above another tab's
                content. readTab decides what a URL means and this only obeys. */}
            {tab === 'config' && (
                <>
                    <RateConfigPanel config={view.rateConfig} />
                    <EmployeeConfigPanel configs={configs} />
                </>
            )}

            {tab === 'adelantos' && (
                /* The picker offers the same people the CONFIG panel lists, so
                   an advance cannot be opened against somebody who is not on the
                   screen their rate would have to be set on. That is why configs
                   is still fetched for this tab. */
                <AdvancesPanel
                    advances={advances}
                    people={configs.map(c => ({
                        cloverEmployeeId: c.cloverEmployeeId,
                        employeeName: c.employeeName,
                    }))}
                    defaultWeekEnding={lastCompleteWeekEnding()}
                />
            )}

            {tab === 'reportes' && (
                <>
                    {/* The bound is the SUNDAY ending the last complete week, so every
                        day of every finished week is clickable while the week still in
                        progress stays out of reach. Computed on the server: it depends
                        on the BUSINESS date, and a client `new Date()` would offer a
                        week the server considers unfinished during the pre-cutover hours. */}
                    <PayrollWeekTable view={view} maxSelectableDate={lastCompleteWeekEnding()} />

                    <CollapsibleSection title={t('importer_section')} testId="timesheet-section">
                        <TimesheetImporter />
                    </CollapsibleSection>

                    {/* The employer's own cost of a run — taxes, workers comp and
                        ADP's fee — which nothing else on this page knows. The
                        weekly figures above are gross pay from the worker's side
                        and are understated as a COST by everything in here. */}
                    <CollapsibleSection title={t('adp_section')} testId="adp-section">
                        <AdpLiabilityImporter />
                        <AdpRunsList runs={adpRuns} />
                    </CollapsibleSection>
                </>
            )}
        </div>
    );
}
