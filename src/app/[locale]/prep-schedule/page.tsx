'use client';
import { useTranslations } from 'next-intl';

export default function PrepSchedulePage() {
    const t = useTranslations();
    return (
        <div style={{ padding: '2rem', textAlign: 'center', marginTop: '4rem' }}>
            <h1 style={{ fontSize: '2rem', marginBottom: '1rem', color: 'var(--text-primary)' }}>
                Prep Schedule
            </h1>
            <p style={{ color: 'var(--text-secondary)' }}>
                Page wiped clean as requested. Rebuilding from scratch.
            </p>
        </div>
    );
}
