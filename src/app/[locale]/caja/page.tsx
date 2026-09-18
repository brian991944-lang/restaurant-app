import { getTranslations } from 'next-intl/server';
import { getWaitStaff } from '@/app/actions/clover';
import CajaTab from './CajaTab';

export const dynamic = 'force-dynamic';

/**
 * Cash Boxes. The staff list is read here, once, and handed to the client
 * body; everything else on the page is fetched by the client after mount.
 */
export default async function CajaPage() {
    const t = await getTranslations('Caja');
    const { staff } = await getWaitStaff();

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', maxWidth: '900px', margin: '0 auto', padding: '1.5rem' }}>
            <h1 style={{ fontSize: '2.5rem', margin: 0, color: 'var(--text-primary)' }}>
                {t('title')}
            </h1>
            <CajaTab staff={staff} />
        </div>
    );
}
