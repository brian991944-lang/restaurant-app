import { getTranslations } from 'next-intl/server';
import TimesheetImporter from './TimesheetImporter';

export default async function PayrollPage() {
    const t = await getTranslations('Payroll');

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', maxWidth: '1100px', margin: '0 auto', padding: '1.5rem' }}>
            <div>
                <h1 style={{ fontSize: '2.5rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                    {t('title')}
                </h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem', margin: 0 }}>
                    {t('subtitle')}
                </p>
            </div>

            <TimesheetImporter />
        </div>
    );
}
