import { getTranslations } from 'next-intl/server';
import { getWaitStaff } from '@/app/actions/clover';
import { listGiftCards } from '@/app/actions/giftCards';
import GiftCardsView from './GiftCardsView';

export const dynamic = 'force-dynamic';

/**
 * Gift Cards. Any Salón employee issues a card here; the email goes out from
 * the restaurant's address the moment it is saved. The staff list (for "who
 * issued it") and the first page of cards are read once on the server.
 */
export default async function GiftCardsPage() {
    const t = await getTranslations('GiftCards');
    const [{ staff }, cards] = await Promise.all([getWaitStaff(), listGiftCards()]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '1100px', margin: '0 auto', padding: '1.5rem' }}>
            <div>
                <h1 style={{ fontSize: '2.5rem', margin: 0, color: 'var(--text-primary)' }}>{t('title')}</h1>
                <p style={{ color: 'var(--text-secondary)', margin: '0.4rem 0 0' }}>{t('subtitle')}</p>
            </div>
            <GiftCardsView staff={staff} initialCards={cards} />
        </div>
    );
}
