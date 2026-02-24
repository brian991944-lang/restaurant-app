'use client';

import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { LayoutDashboard, Package, ShoppingCart, Tags, ChefHat, Calendar, TrendingUp, Moon, Sun, Globe, Network, Database, X } from 'lucide-react';
import { useEffect, useState } from 'react';

interface SidebarProps {
    locale: string;
    isOpen?: boolean;
    onClose?: () => void;
}

export default function Sidebar({ locale, isOpen = true, onClose }: SidebarProps) {
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
        <>
            {/* Mobile Backdrop overlay */}
            {isOpen && (
                <div
                    className="sidebar-backdrop"
                    onClick={onClose}
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(0,0,0,0.5)',
                        zIndex: 45
                    }}
                />
            )}

            <style jsx>{`
                aside {
                    transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                }
                @media (max-width: 1024px) {
                    aside {
                        position: fixed !important;
                        transform: translateX(${isOpen ? '0' : '-100%'});
                        box-shadow: ${isOpen ? '4px 0 24px rgba(0,0,0,0.15)' : 'none'};
                    }
                    .sidebar-backdrop {
                        display: block;
                    }
                }
                @media (min-width: 1025px) {
                    aside {
                        position: sticky !important;
                        transform: translateX(0) !important;
                    }
                    .sidebar-backdrop {
                        display: none !important;
                    }
                    .mobile-close-btn {
                        display: none !important;
                    }
                }
            `}</style>

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
                <div style={{ padding: '2rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(150, 150, 150, 0.1)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
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
                    {/* Mobile Close Button */}
                    <button
                        className="mobile-close-btn"
                        onClick={onClose}
                        style={{ color: 'var(--text-secondary)', padding: '0.25rem', display: 'flex' }}
                    >
                        <X size={20} />
                    </button>
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
                                onClick={() => {
                                    if (window.innerWidth <= 1024 && onClose) {
                                        onClose();
                                    }
                                }}
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
        </>
    );
}
