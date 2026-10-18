'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useAdmin } from '@/components/AdminContext';
import { Card, PhoneHeader, Row, Section, page } from '@/components/phone/ui';
import { analyticsHref, ANALYTICS_VIEWS } from '@/lib/analyticsView';
import { useEffect, useState } from 'react';
import { isAdminDevice, clearAdminDevice, markAdminDevice, onAdminDeviceChange } from '@/lib/adminDevice';
import { useIsPhone } from '@/components/phone/usePhone';

/** Más — everything the sidebar offers, as grouped lists for the phone, plus theme, language and leaving Admin. */
export default function MasView({ locale }: { locale: 'es' | 'en' }) {
    const t = useTranslations('Phone');
    const tn = useTranslations('Nav');
    const { theme, setTheme } = useTheme();
    const { setIsAdmin } = useAdmin();
    const router = useRouter();
    const pathname = usePathname();

    // "Pedir huella al abrir": the Admin-phone flag. Phones only — the flag cannot
    // be set on a tablet or a PC, so the row is not offered there.
    const phone = useIsPhone();
    const [adminDevice, setAdminDevice] = useState(false);
    // The theme is unknown on the server (next-themes), so its label is filled in after mount
    // instead of hydrating "Sistema" over "Oscuro".
    const [mounted, setMounted] = useState(false);
    useEffect(() => { setMounted(true); setAdminDevice(isAdminDevice()); return onAdminDeviceChange(() => setAdminDevice(isAdminDevice())); }, []);
    const toggleAdminDevice = () => { if (adminDevice) clearAdminDevice(); else markAdminDevice(); };

    const other = locale === 'en' ? 'es' : 'en';
    const switchLanguage = () => router.push(pathname.replace(`/${locale}`, `/${other}`));
    const leaveAdmin = () => { setIsAdmin(false); router.push(`/${locale}/inventory`); };
    const L = (path: string) => `/${locale}${path}`;

    const groups: { title: string; items: { label: string; sub?: string; href: string }[] }[] = [
        { title: t('groupSales'), items: [
            { label: tn('analytics'), sub: ANALYTICS_VIEWS.map(v => tn(`analytics_${v}`)).join(' · '), href: analyticsHref(locale, 'resumen') },
            { label: tn('finanzas'), href: L('/finanzas') },
            { label: tn('reports'), sub: `${tn('reports_nomina')} · ${tn('reports_archivos')}`, href: L('/reports?tab=gastos') },
            { label: tn('raw_data'), href: L('/data') },
        ] },
        { title: t('groupKitchen'), items: [
            { label: tn('dashboard'), href: L('/dashboard') },
            { label: tn('inventory'), href: L('/inventory') },
            { label: tn('purchases'), sub: t('comprasSub'), href: L('/compras') },
            { label: tn('almacen'), sub: t('almacenSub'), href: L('/almacen') },
            { label: tn('prep_schedule'), href: L('/prep-schedule') },
            { label: tn('recetario'), href: L('/recetario') },
            { label: tn('menu'), href: L('/menu') },
        ] },
        { title: t('groupSalon'), items: [
            { label: tn('inventory_salon'), href: L('/inventory-salon') },
            { label: tn('caja'), href: L('/caja') },
            { label: tn('tips_reviews'), href: L('/tips-reviews') },
            { label: tn('gift_cards'), href: L('/gift-cards') },
            { label: tn('closing_lists'), href: L('/closing-lists') },
        ] },
        { title: t('groupTeam'), items: [
            { label: tn('payroll'), href: L('/payroll') },
            { label: tn('admin_app'), sub: t('adminAppSub'), href: L('/admin') },
        ] },
    ];

    return (
        <div style={page}>
            <PhoneHeader title={t('masTitle')} />
            {groups.map(g => (
                <Card key={g.title} style={{ padding: '0.75rem 1rem 0.35rem' }}>
                    <Section title={g.title} />
                    <div style={{ marginTop: 2 }}>
                        {g.items.map((it, i) => <Row key={it.href} href={it.href} title={it.label} sub={it.sub} last={i === g.items.length - 1} />)}
                    </div>
                </Card>
            ))}
            <Card style={{ padding: '0.75rem 1rem 0.35rem' }}>
                <Section title={t('groupSettings')} />
                <div style={{ marginTop: 2 }}>
                    <Row title={t('theme')} sub={!mounted ? '' : theme === 'dark' ? t('themeDark') : theme === 'light' ? t('themeLight') : t('themeSystem')}
                        onClick={() => setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark')} />
                    <Row title={t('language')} sub={locale === 'es' ? 'Español' : 'English'} rsub={locale === 'es' ? 'English →' : 'Español →'} onClick={switchLanguage} />
                    {phone && <Row title={t('adminDevice')} sub={adminDevice ? t('adminDeviceOn') : t('adminDeviceOff')} onClick={toggleAdminDevice} />}
                    <Row title={tn('exit_admin')} sub={t('exitAdminSub')} onClick={leaveAdmin} last />
                </div>
            </Card>
        </div>
    );
}
