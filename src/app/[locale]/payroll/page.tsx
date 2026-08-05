import { getTranslations } from 'next-intl/server';
import { getPayrollWeek } from '@/app/actions/payroll';
import { getBusinessDate, getBusinessDayOfWeek } from '@/lib/businessDay';
import RateConfigPanel from './RateConfigPanel';
import PayrollWeekTable from './PayrollWeekTable';
import CollapsibleSection from './CollapsibleSection';
import TimesheetImporter from './TimesheetImporter';

/**
 * Monday of the most recent COMPLETE week — the week picker's upper bound.
 *
 * Computed here rather than on the client because it depends on the BUSINESS
 * date, which the 5 AM cutover can put a day behind the device's calendar date;
 * a client-side `new Date()` would offer a week the server considers unfinished.
 *
 * This mirrors lastCompleteWeekEnding() in actions/payroll.ts, which cannot be
 * imported: 'use server' turns every export in that file into a callable action.
 */
function latestSelectableWeekStart(): string {
    const today = getBusinessDate();
    const dow = getBusinessDayOfWeek(today);          // 0 = Sunday
    const [y, m, d] = today.split('-').map(Number);
    // Back to the Sunday ending the last complete week, then back to its Monday.
    const t = new Date(Date.UTC(y, m - 1, d - (dow === 0 ? 7 : dow) - 6));
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

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

            <PayrollWeekTable view={view} maxWeekStart={latestSelectableWeekStart()} />

            <CollapsibleSection title={t('importer_section')}>
                <TimesheetImporter />
            </CollapsibleSection>
        </div>
    );
}
