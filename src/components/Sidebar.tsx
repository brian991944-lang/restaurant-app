'use client';

import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { LayoutDashboard, Package, ShoppingCart, Tags, ChefHat, Calendar, TrendingUp, Moon, Sun, Globe, Network, Database, Menu, ChevronLeft, BookOpen, Coffee, Landmark, Briefcase } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAdmin } from '@/components/AdminContext';
import { useWorkstation } from '@/components/WorkstationContext';

/** The stations a nav item can belong to. Every item declares exactly one. */
type Station = 'Cocina' | 'Salon' | 'Management';

export default function Sidebar({ locale, isOpen, onClose }: { locale: string, isOpen?: boolean, onClose?: () => void }) {
    const t = useTranslations('Nav');
    const router = useRouter();
    const pathname = usePathname();
    const { theme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);
    const [isCollapsed, setIsCollapsed] = useState(false);

    // Admin View State
    const { isAdmin, setIsAdmin } = useAdmin();
    const { station, setStation } = useWorkstation();
    const [showAdminModal, setShowAdminModal] = useState(false);
    const [passwordInput, setPasswordInput] = useState('');
    const [loginError, setLoginError] = useState(false);

    const switchStation = (newStation: Station) => {
        setStation(newStation);
        if (!isAdmin) {
            if (newStation === 'Cocina') {
                router.push(`/${locale}/inventory`);
            } else if (newStation === 'Salon') {
                router.push(`/${locale}/inventory-salon`);
            }
            // Management is admin-only, so a non-admin never lands here.
        }
    };

    useEffect(() => {
        setMounted(true);
    }, []);

    // Leaving admin takes the Management pill away with it, so a station that
    // no longer has a pill has to move somewhere that does. Guarded, so it
    // settles in one pass rather than looping.
    useEffect(() => {
        if (!isAdmin && station === 'Management') setStation('Salon');
    }, [isAdmin, station, setStation]);

    const toggleLanguage = () => {
        const nextLocale = locale === 'en' ? 'es' : 'en';
        const newPath = pathname.replace(`/${locale}`, `/${nextLocale}`);
        router.push(newPath || `/${nextLocale}`);
    };

    // Each item names its own station. Matching on href substrings needed
    // endsWith('/inventory') so the salón page could not leak into Cocina; a
    // declared station cannot be near-missed like that in the first place.
    const navItems: { name: string; href: string; icon: typeof Package; station: Station }[] = [
        { name: t('dashboard'), href: `/${locale}/dashboard`, icon: LayoutDashboard, station: 'Cocina' },
        { name: t('inventory'), href: `/${locale}/inventory`, icon: Package, station: 'Cocina' },
        { name: t('purchases'), href: `/${locale}/compras`, icon: ShoppingCart, station: 'Cocina' },
        { name: t('recetario'), href: `/${locale}/recetario`, icon: BookOpen, station: 'Cocina' },
        { name: t('prep_schedule'), href: `/${locale}/prep-schedule`, icon: Calendar, station: 'Cocina' },

        { name: t('inventory_salon'), href: `/${locale}/inventory-salon`, icon: Package, station: 'Salon' },
        { name: t('tips_reviews'), href: `/${locale}/tips-reviews`, icon: TrendingUp, station: 'Salon' },
        { name: t('gift_cards'), href: `/${locale}/gift-cards`, icon: Tags, station: 'Salon' },
        { name: t('closing_lists'), href: `/${locale}/closing-lists`, icon: LayoutDashboard, station: 'Salon' },

        { name: t('menu'), href: `/${locale}/menu`, icon: ChefHat, station: 'Management' },
        { name: t('sales'), href: `/${locale}/sales`, icon: TrendingUp, station: 'Management' },
        { name: t('raw_data'), href: `/${locale}/data`, icon: Database, station: 'Management' },
        { name: t('finanzas'), href: `/${locale}/finanzas`, icon: Landmark, station: 'Management' },
    ];

    /**
     * A station is always in effect, for admins too — admin no longer bypasses
     * the filter, it just unlocks a third station.
     *
     * Null resolves to Salón, which covers a tablet that has never chosen one
     * and the first render before localStorage has been read. Management also
     * resolves to Salón without admin, so the one render before the effect
     * above fires cannot flash items that should not be visible.
     */
    const activeStation: Station =
        station === 'Cocina' ? 'Cocina'
            : station === 'Management' && isAdmin ? 'Management'
                : 'Salon';

    const filteredNavItems = navItems
        .filter(item => item.station === activeStation)
        // The kitchen reads the dashboard as their shift summary, not as a
        // management overview, and it is named for them.
        .map(item => activeStation === 'Cocina' && item.href === `/${locale}/dashboard`
            ? { ...item, name: locale === 'es' ? 'Resumen' : 'Summary' }
            : item);

    const stationPills = [
        { key: 'Cocina' as const, label: 'Cocina', Icon: ChefHat, tint: 'rgba(168, 85, 247, 0.1)', accent: 'var(--accent-primary)' },
        { key: 'Salon' as const, label: 'Salón', Icon: Coffee, tint: 'rgba(56, 189, 248, 0.1)', accent: 'var(--accent-secondary)' },
        { key: 'Management' as const, label: t('management'), Icon: Briefcase, tint: 'rgba(34, 197, 94, 0.1)', accent: 'var(--success)' }
    ].filter(pill => pill.key !== 'Management' || isAdmin);

    return (
        <>
            {isOpen && (
                <div 
                    className="mobile-overlay" 
                    onClick={onClose}
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        width: '100vw',
                        height: '100vh',
                        background: 'rgba(0,0,0,0.5)',
                        zIndex: 998,
                        display: 'block'
                    }} 
                />
            )}
            <aside className={`sidebar-container ${isOpen ? 'sidebar-mobile-open' : ''}`} style={{
                width: isCollapsed ? '80px' : '280px',
                height: '100vh',
                background: 'var(--bg-glass)',
                backdropFilter: 'blur(16px)',
                borderRight: '1px solid var(--glass-border)',
                display: 'flex',
                flexDirection: 'column',
                position: 'sticky',
                top: 0,
                left: 0,
                zIndex: 999,
                transition: 'width 0.3s ease, transform 0.3s ease'
            }}>
            {/* Logo Area */}
            <div className="sidebar-toggle-tablet" style={{ padding: isCollapsed ? '2rem 0' : '2rem 1.5rem', display: 'flex', alignItems: 'center', justifyContent: isCollapsed ? 'center' : 'space-between', borderBottom: '1px solid var(--border)' }}>
                {!isCollapsed && (
                    <div className="sidebar-hide-tablet" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
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
                )}
                <button onClick={() => {
                    if (isOpen && onClose) {
                        onClose();
                    } else {
                        setIsCollapsed(!isCollapsed);
                    }
                }} style={{ color: 'var(--text-secondary)', padding: isCollapsed ? '0' : '0.5rem', background: 'transparent', border: 'none', cursor: 'pointer' }}>
                    {(isCollapsed && !isOpen) ? <Menu size={24} /> : <ChevronLeft size={24} />}
                </button>
            </div>

            {/* Navigation Links */}
            <nav className="sidebar-nav-tablet" style={{ flex: 1, padding: isCollapsed ? '1.5rem 0' : '1.5rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', overflowY: 'auto', alignItems: isCollapsed ? 'center' : 'stretch' }}>
                {filteredNavItems.map((item) => {
                    const isActive = pathname.startsWith(item.href);
                    const Icon = item.icon;
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            className="sidebar-link-tablet"
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: isCollapsed ? 'center' : 'flex-start',
                                gap: isCollapsed ? '0' : '1rem',
                                padding: isCollapsed ? '1rem' : '1rem 1.25rem',
                                borderRadius: '12px',
                                textDecoration: 'none',
                                color: isActive ? 'white' : 'var(--text-secondary)',
                                background: isActive ? 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))' : 'transparent',
                                fontWeight: isActive ? 600 : 500,
                                transition: 'all 0.2s ease',
                                boxShadow: isActive ? '0 4px 15px rgba(59, 130, 246, 0.3)' : 'none',
                                width: isCollapsed ? '50px' : 'auto'
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
                            title={isCollapsed ? item.name : undefined}
                        >
                            <Icon size={20} />
                            {!isCollapsed && <span className="sidebar-hide-tablet">{item.name}</span>}
                        </Link>
                    )
                })}
            </nav>

            {/* Bottom Controls */}
            <div className="sidebar-bottom-tablet" style={{ padding: isCollapsed ? '1.5rem 0' : '1.5rem', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: isCollapsed ? 'center' : 'stretch' }}>

                {/* WORKSTATION TOGGLE HERE */}
                {!isCollapsed && (
                    <div className="sidebar-hide-tablet" style={{ display: 'flex', background: 'var(--bg-primary)', borderRadius: '12px', padding: '0.25rem', border: '1px solid var(--glass-border)' }}>
                        {stationPills.map(pill => {
                            // Highlighted against the station actually in force,
                            // so an unset one reads as Salón rather than as
                            // nothing being selected.
                            const isOn = activeStation === pill.key;
                            return (
                                <button
                                    key={pill.key}
                                    onClick={() => switchStation(pill.key)}
                                    style={{ flex: 1, padding: '0.6rem 0.4rem', borderRadius: '8px', border: 'none', background: isOn ? pill.tint : 'transparent', color: isOn ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: isOn ? 600 : 400, fontSize: '0.85rem', whiteSpace: 'nowrap', transition: 'all 0.2s', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem' }}>
                                    <pill.Icon size={16} color={isOn ? pill.accent : 'currentColor'} />
                                    {pill.label}
                                </button>
                            );
                        })}
                    </div>
                )}

                <div style={{ display: 'flex', flexDirection: isCollapsed ? 'column' : 'row', justifyContent: 'space-between', alignItems: 'center', gap: isCollapsed ? '1rem' : '0' }}>

                    {/* Language Switch */}
                    <button
                        onClick={toggleLanguage}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: isCollapsed ? '0' : '0.5rem',
                            padding: '0.6rem',
                            borderRadius: '12px',
                            background: 'var(--bg-secondary)',
                            color: 'var(--text-primary)',
                            border: '1px solid var(--border)',
                            fontWeight: 500,
                            transition: 'all 0.2s',
                            flex: isCollapsed ? 'none' : 1,
                            marginRight: isCollapsed ? '0' : '0.5rem'
                        }}
                        onMouseOver={(e) => e.currentTarget.style.background = 'var(--bg-primary)'}
                        onMouseOut={(e) => e.currentTarget.style.background = 'var(--bg-secondary)'}
                        title={isCollapsed ? (locale === 'en' ? 'EN / ES' : 'ES / EN') : undefined}
                    >
                        <Globe size={16} />
                        {!isCollapsed && <span className="sidebar-hide-tablet">{locale === 'en' ? 'EN / ES' : 'ES / EN'}</span>}
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
                                border: '1px solid var(--border)',
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

                {/* Admin View Button */}
                {!isCollapsed && (
                    <button
                        onClick={() => {
                            if (isAdmin) {
                                setIsAdmin(false);
                            } else {
                                setShowAdminModal(true);
                                setLoginError(false);
                                setPasswordInput('');
                            }
                        }}
                        className={`sidebar-hide-tablet ${isAdmin ? "btn-secondary" : "btn-primary"}`}
                        style={{ width: '100%', padding: '0.8rem', borderRadius: '12px', textAlign: 'center' }}
                    >
                        {isAdmin ? 'Exit Admin' : 'Admin View'}
                    </button>
                )}
            </div>

            {/* Admin Password Modal */}
            {showAdminModal && (
                <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="glass-panel" style={{ padding: '2rem', width: '320px', display: 'flex', flexDirection: 'column', gap: '1rem', background: 'var(--bg-glass)', backdropFilter: 'blur(16px)', border: '1px solid var(--glass-border)', borderRadius: '16px' }}>
                        <h3 style={{ margin: 0, color: 'var(--text-primary)' }}>Admin Access</h3>
                        <input
                            type="password"
                            value={passwordInput}
                            onChange={e => { setPasswordInput(e.target.value); setLoginError(false); }}
                            onKeyDown={e => {
                                if (e.key === 'Enter') {
                                    if (passwordInput === 'Fus10nY&Y') {
                                        setIsAdmin(true);
                                        setShowAdminModal(false);
                                    } else {
                                        setLoginError(true);
                                    }
                                }
                            }}
                            className="input-field"
                            placeholder="Password"
                            style={{ padding: '0.8rem', width: '100%' }}
                            autoFocus
                        />
                        {loginError && <span style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>Acceso Denegado</span>}
                        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                            <button onClick={() => setShowAdminModal(false)} className="btn-secondary" style={{ padding: '0.5rem 1rem' }}>Cancel</button>
                            <button
                                onClick={() => {
                                    if (passwordInput === 'Fus10nY&Y') {
                                        setIsAdmin(true);
                                        setShowAdminModal(false);
                                    } else {
                                        setLoginError(true);
                                    }
                                }}
                                className="btn-primary"
                                style={{ padding: '0.5rem 1rem' }}
                            >
                                Unlock
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </aside>
        </>
    );
}
