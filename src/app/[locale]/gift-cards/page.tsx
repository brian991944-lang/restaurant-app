'use client';
import { Tags } from 'lucide-react';
import { useTranslations } from 'next-intl';

export default function GiftCardsPage() {
    const t = useTranslations('GiftCards');
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', maxWidth: '1200px', margin: '0 auto', padding: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <h1 style={{ fontSize: '2.5rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>{t('title')}</h1>
                    <p style={{ color: 'var(--text-secondary)' }}>{t('subtitle')}</p>
                </div>
            </div>

            <div className="glass-panel" style={{ padding: '3rem', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                <div style={{ background: 'var(--bg-secondary)', padding: '1.5rem', borderRadius: '50%', marginBottom: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Tags size={48} color="var(--accent-secondary)" />
                </div>
                <h3 style={{ fontSize: '1.5rem', margin: 0, color: 'var(--text-primary)' }}>{t('under_construction')}</h3>
                <p style={{ color: 'var(--text-secondary)', maxWidth: '400px' }}>{t('under_construction_body')}</p>
            </div>
        </div>
    );
}
