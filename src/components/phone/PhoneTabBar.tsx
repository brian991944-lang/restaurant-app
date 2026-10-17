'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Home, BarChart3, LineChart, UtensilsCrossed, MoreHorizontal } from 'lucide-react';
import { useAdmin } from '@/components/AdminContext';
import { useIsPhone } from './usePhone';

/**
 * The Admin app on a phone: a bottom tab bar instead of the hamburger +
 * sidebar rail. Shown only to an unlocked admin on a phone-sized viewport;
 * the kitchen iPad and the desktop keep the sidebar untouched. While it is
 * shown, `body.phone-admin` hides the mobile header and the sidebar rail and
 * pads the page so content never hides behind the bar (see the style below).
 */
export default function PhoneTabBar({ locale }: { locale: string }) {
    const t = useTranslations('Phone');
    const { isAdmin, isLoaded } = useAdmin();
    const phone = useIsPhone();
    const pathname = usePathname();
    const on = isLoaded && isAdmin && phone;

    useEffect(() => {
        document.body.classList.toggle('phone-admin', on);
        return () => document.body.classList.remove('phone-admin');
    }, [on]);

    if (!on) return null;

    const p = pathname.replace(/^\/(en|es)/, '');
    const tabs = [
        { key: 'hoy', label: t('tabHoy'), href: `/${locale}/hoy`, Icon: Home, active: p === '/hoy' || p === '' || p === '/' },
        { key: 'ventas', label: t('tabVentas'), href: `/${locale}/ventas`, Icon: BarChart3, active: p.startsWith('/ventas') },
        { key: 'analiticas', label: t('tabAnaliticas'), href: `/${locale}/analytics/resumen`, Icon: LineChart, active: p.startsWith('/analytics') },
        { key: 'cocina', label: t('tabCocina'), href: `/${locale}/inventory`, Icon: UtensilsCrossed, active: ['/inventory', '/prep-schedule', '/compras', '/recetario', '/almacen', '/dashboard'].some(s => p.startsWith(s)) },
        { key: 'mas', label: t('tabMas'), href: `/${locale}/mas`, Icon: MoreHorizontal, active: p.startsWith('/mas') },
    ];

    return (
        <>
            <style>{`
                body.phone-admin .mobile-header { display: none !important; }
                body.phone-admin .sidebar-container:not(.sidebar-mobile-open) { display: none !important; }
                body.phone-admin .page-container { padding: 1rem 1rem calc(88px + env(safe-area-inset-bottom)) !important; }
            `}</style>
            <nav aria-label={t('tabsLabel')}
                style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 900, display: 'flex', borderTop: '1px solid var(--border)', background: 'var(--bg-primary)',
                    paddingBottom: 'env(safe-area-inset-bottom)' }}>
                {tabs.map(({ key, label, href, Icon, active }) => (
                    <Link key={key} href={href} aria-current={active ? 'page' : undefined}
                        style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, padding: '8px 0 10px', minHeight: 56, textDecoration: 'none',
                            color: active ? 'var(--accent-primary)' : 'var(--text-secondary)' }}>
                        <Icon size={22} strokeWidth={active ? 2.4 : 2} />
                        <span style={{ fontSize: '0.68rem', fontWeight: active ? 700 : 500 }}>{label}</span>
                    </Link>
                ))}
            </nav>
        </>
    );
}
