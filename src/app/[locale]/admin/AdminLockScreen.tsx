'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ShieldCheck } from 'lucide-react';
import { useAdmin } from '@/components/AdminContext';
import AdminUnlockModal from '@/components/AdminUnlockModal';

/**
 * Full-screen lock for the Admin install. Reuses the sidebar's unlock sheet in
 * its "screen" variant (solid background, no dismiss), so passkey + password
 * behave exactly as they do everywhere else. Unlocking flips AdminContext —
 * same sessionStorage flag and 12h cookie — and lands on the dashboard.
 *
 * Launched from the installed app (standalone) and already unlocked → straight
 * to the dashboard. Opened in a browser tab while unlocked → a small
 * "Admin desbloqueado" card with the install hint, so this page can still be
 * added to the home screen (iOS installs whatever page you're on).
 */
export default function AdminLockScreen({ locale }: { locale: 'es' | 'en' }) {
    const t = useTranslations('Nav');
    const router = useRouter();
    const { isAdmin, setIsAdmin, isLoaded } = useAdmin();
    const [standalone, setStandalone] = useState<boolean | null>(null);

    useEffect(() => {
        try {
            setStandalone(window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true);
        } catch { setStandalone(false); }
    }, []);

    // Phones land on the Hoy screen (bottom tabs); tablets and PCs keep the dashboard.
    const dashboard = typeof window !== 'undefined' && window.matchMedia('(max-width: 700px)').matches ? `/${locale}/hoy` : `/${locale}/dashboard`;
    useEffect(() => {
        if (standalone === null || !isLoaded) return;
        if (isAdmin && standalone) router.replace(dashboard);
    }, [standalone, isLoaded, isAdmin, dashboard, router]);

    // Solid cover while AdminContext reads sessionStorage, and during the redirect.
    if (!isLoaded || standalone === null || (isAdmin && standalone)) {
        return <div style={{ position: 'fixed', inset: 0, background: 'var(--bg-primary)', zIndex: 9999 }} />;
    }

    if (isAdmin) {
        return (
            <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'var(--bg-primary)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', padding: '1rem' }}>
                <div style={{ width: '100%', maxWidth: '380px', background: 'var(--bg-secondary)', border: 'var(--glass-border)', borderRadius: '20px', padding: '1.75rem 1.5rem 1.5rem', textAlign: 'center' }}>
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>
                        <div style={{ width: 64, height: 64, borderRadius: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))', color: 'white' }}>
                            <ShieldCheck size={30} />
                        </div>
                    </div>
                    <h3 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)' }}>{t('admin_unlocked')}</h3>
                    <button onClick={() => router.push(dashboard)} className="btn-primary"
                        style={{ width: '100%', marginTop: '1.25rem', padding: '0.9rem', borderRadius: '12px', fontSize: '0.95rem' }}>
                        {t('admin_continue')}
                    </button>
                </div>
                <div style={{ maxWidth: '380px', textAlign: 'center', fontSize: '0.8rem', lineHeight: 1.45, color: 'var(--text-secondary)', padding: '0 0.5rem' }}>
                    {t('admin_install_hint')}
                </div>
            </div>
        );
    }

    return (
        <AdminUnlockModal
            open
            variant="screen"
            onClose={() => { }}
            onUnlocked={() => setIsAdmin(true)}
            footnote={standalone ? null : t('admin_install_hint')}
        />
    );
}
