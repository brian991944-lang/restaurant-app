import { getTranslations } from 'next-intl/server';
import { getPayrollWeek } from '@/app/actions/payroll';
import RateConfigPanel from './RateConfigPanel';
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
    const view = await getPayrollWeek(requested);

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

            <PayrollWeekTable view={view} />

            <CollapsibleSection title={t('importer_section')}>
                <TimesheetImporter />
            </CollapsibleSection>
        </div>
    );
}
