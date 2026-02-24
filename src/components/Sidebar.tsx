'use client';

import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { LayoutDashboard, Package, ShoppingCart, Tags, ChefHat, Calendar, TrendingUp, Moon, Sun, Globe, Network, Database } from 'lucide-react';
import { useEffect, useState } from 'react';

export default function Sidebar({ locale }: { locale: string }) {
    const t = useTranslations('Nav');
    const router = useRouter();
    const pathname = usePathname();
    const { theme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    const toggleLanguage = () => {
        const nextLocale = locale === 'en' ? 'es' : 'en';
        const newPath = pathname.replace(`/${locale}`, `/${nextLocale}`);
        router.push(newPath || `/${nextLocale}`);
    };

    const navItems = [
        { name: t('dashboard'), href: `/${locale}/dashboard`, icon: LayoutDashboard },
        { name: t('inventory'), href: `/${locale}/inventory`, icon: Package },
        { name: t('purchases'), href: `/${locale}/purchases`, icon: ShoppingCart },
        { name: t('menu'), href: `/${locale}/menu`, icon: ChefHat },
        { name: t('prep_schedule'), href: `/${locale}/prep-schedule`, icon: Calendar },
        { name: t('sales'), href: `/${locale}/sales`, icon: TrendingUp },
        { name: t('integrations'), href: `/${locale}/integrations`, icon: Network },
        { name: t('raw_data'), href: `/${locale}/data`, icon: Database },
    ];

    return (
        <aside style={{
            width: '280px',
            height: '100vh',
            background: 'var(--bg-glass)',
            backdropFilter: 'blur(16px)',
            borderRight: '1px solid var(--glass-border)',
            display: 'flex',
            flexDirection: 'column',
            position: 'sticky',
            top: 0,
            left: 0,
            zIndex: 50
        }}>
            {/* Logo Area */}
            <div style={{ padding: '2rem 1.5rem', display: 'flex', alignItems: 'center', gap: '1rem', borderBottom: '1px solid rgba(150, 150, 150, 0.1)' }}>
                <div style={{
                    background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))',
                    borderRadius: '12px',
                    padding: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                }}>
                    <ChefHat size={24} color="white" />
                </div>
                <div>
                    <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                        Fusionista
                    </h2>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Inventory & Prep</span>
                </div>
            </div>

            {/* Navigation Links */}
            <nav style={{ flex: 1, padding: '1.5rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', overflowY: 'auto' }}>
                {navItems.map((item) => {
                    const isActive = pathname.startsWith(item.href);
                    const Icon = item.icon;
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '1rem',
                                padding: '1rem 1.25rem',
                                borderRadius: '12px',
                                textDecoration: 'none',
                                color: isActive ? 'white' : 'var(--text-secondary)',
                                background: isActive ? 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))' : 'transparent',
                                fontWeight: isActive ? 600 : 500,
                                transition: 'all 0.2s ease',
                                boxShadow: isActive ? '0 4px 15px rgba(59, 130, 246, 0.3)' : 'none'
                            }}
                            onMouseOver={(e) => {
                                if (!isActive) {
                                    e.currentTarget.style.background = 'rgba(150, 150, 150, 0.1)';
                                    e.currentTarget.style.color = 'var(--text-primary)';
                                }
                            }}
                            onMouseOut={(e) => {
                                if (!isActive) {
                                    e.currentTarget.style.background = 'transparent';
                                    e.currentTarget.style.color = 'var(--text-secondary)';
                                }
                            }}
                        >
                            <Icon size={20} />
                            {item.name}
                        </Link>
                    )
                })}
            </nav>

            {/* Bottom Controls */}
            <div style={{ padding: '1.5rem', borderTop: '1px solid rgba(150, 150, 150, 0.1)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>

                    {/* Language Switch */}
                    <button
                        onClick={toggleLanguage}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            padding: '0.6rem 1rem',
                            borderRadius: '12px',
                            background: 'var(--bg-secondary)',
                            color: 'var(--text-primary)',
                            border: '1px solid rgba(150,150,150,0.1)',
                            fontWeight: 500,
                            transition: 'all 0.2s',
                            flex: 1,
                            marginRight: '0.5rem'
                        }}
                        onMouseOver={(e) => e.currentTarget.style.background = 'var(--bg-primary)'}
                        onMouseOut={(e) => e.currentTarget.style.background = 'var(--bg-secondary)'}
                    >
                        <Globe size={16} />
                        {locale === 'en' ? 'EN / ES' : 'ES / EN'}
                    </button>

                    {/* Theme Toggle */}
                    {mounted && (
                        <button
                            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                            style={{
                                padding: '0.6rem',
                                borderRadius: '12px',
                                background: 'var(--bg-secondary)',
                                color: 'var(--text-primary)',
                                border: '1px solid rgba(150,150,150,0.1)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transition: 'all 0.2s'
                            }}
                            onMouseOver={(e) => e.currentTarget.style.background = 'var(--bg-primary)'}
                            onMouseOut={(e) => e.currentTarget.style.background = 'var(--bg-secondary)'}
                        >
                            {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
                        </button>
                    )}
                </div>

                {/* Login Button */}
                <button
                    className="btn-primary"
                    style={{ width: '100%', padding: '0.8rem', borderRadius: '12px', textAlign: 'center' }}
                >
                    {t('login')}
                </button>
            </div>
        </aside>
    );
}
