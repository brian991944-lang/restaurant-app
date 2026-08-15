'use client';

import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import { LayoutDashboard, Package, ShoppingCart, Tags, ChefHat, Calendar, TrendingUp, Moon, Sun, Globe, Network, Database, Menu, ChevronLeft, ChevronDown, ChevronRight, BookOpen, Coffee, Landmark, Briefcase, Clock, FileBarChart, Receipt, Files } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAdmin } from '@/components/AdminContext';
import { useWorkstation } from '@/components/WorkstationContext';
import { readReportsTab } from '@/lib/reportsTab';

/** The stations a nav item can belong to. Every item declares exactly one. */
type Station = 'Cocina' | 'Salon' | 'Management';

/**
 * A child link inside an expandable section.
 *
 * `isActive` is a predicate rather than an href to string-match, because
 * siblings can share a pathname and differ only in the query — the two Reports
 * children are both /reports and are told apart by ?tab. `pathname.startsWith`
 * cannot separate those and would light up both at once.
 *
 * Passing the predicate keeps this array generic: a future section brings its
 * own rule instead of teaching the sidebar about every route's parameters.
 */
type NavChild = {
    name: string;
    href: string;
    icon: typeof Package;
    isActive: (pathname: string, params: URLSearchParams) => boolean;
};

type NavItem = {
    /** Stable across locales — the expansion map is keyed by this, not by `name`,
     *  which changes when the language does. */
    key: string;
    name: string;
    /** Absent on a parent that only expands. A parent that does not navigate
     *  must not carry a route, or it would match as active for its children. */
    href?: string;
    icon: typeof Package;
    station: Station;
    children?: NavChild[];
    /** Pathname prefix meaning "the current route lives in this section", which
     *  is what auto-expands it. Only meaningful alongside `children`. */
    sectionPath?: string;
};

export default function Sidebar({ locale, isOpen, onClose }: { locale: string, isOpen?: boolean, onClose?: () => void }) {
    const t = useTranslations('Nav');
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const { theme, setTheme } = useTheme();
    const [mounted, setMounted] = useState(false);
    const [isCollapsed, setIsCollapsed] = useState(false);

    /**
     * Which sections the user has explicitly opened or closed, by item key.
     *
     * Deliberately NOT persisted, and deliberately sparse: a key is only written
     * once someone clicks. An absent key falls through to "open if the current
     * route is in this section", so arriving at /reports by URL shows you where
     * you are, while a section you closed by hand stays closed.
     *
     * Storing a resolved boolean per section instead would need an effect to
     * seed it from the route, and that effect would fight the user every time
     * the route changed.
     */
    const [sectionOverrides, setSectionOverrides] = useState<Record<string, boolean>>({});

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
    const reportsPath = `/${locale}/reports`;

    /**
     * The Reports children share one pathname and are told apart by ?tab, so the
     * predicate reads the tab through readReportsTab — the SAME allow-list the
     * page uses. An unrecognised ?tab falls back to gastos in both places
     * because both ask the same function, rather than because two copies of the
     * fallback happen to agree.
     */
    const reportsTabIs = (want: 'gastos' | 'archivos') =>
        (path: string, params: URLSearchParams) =>
            path.startsWith(reportsPath) && readReportsTab(params.get('tab') ?? undefined) === want;

    const navItems: NavItem[] = [
        { key: 'dashboard', name: t('dashboard'), href: `/${locale}/dashboard`, icon: LayoutDashboard, station: 'Cocina' },
        { key: 'inventory', name: t('inventory'), href: `/${locale}/inventory`, icon: Package, station: 'Cocina' },
        { key: 'purchases', name: t('purchases'), href: `/${locale}/compras`, icon: ShoppingCart, station: 'Cocina' },
        { key: 'recetario', name: t('recetario'), href: `/${locale}/recetario`, icon: BookOpen, station: 'Cocina' },
        { key: 'prep_schedule', name: t('prep_schedule'), href: `/${locale}/prep-schedule`, icon: Calendar, station: 'Cocina' },

        { key: 'inventory_salon', name: t('inventory_salon'), href: `/${locale}/inventory-salon`, icon: Package, station: 'Salon' },
        { key: 'tips_reviews', name: t('tips_reviews'), href: `/${locale}/tips-reviews`, icon: TrendingUp, station: 'Salon' },
        { key: 'gift_cards', name: t('gift_cards'), href: `/${locale}/gift-cards`, icon: Tags, station: 'Salon' },
        { key: 'closing_lists', name: t('closing_lists'), href: `/${locale}/closing-lists`, icon: LayoutDashboard, station: 'Salon' },

        { key: 'menu', name: t('menu'), href: `/${locale}/menu`, icon: ChefHat, station: 'Management' },
        { key: 'sales', name: t('sales'), href: `/${locale}/sales`, icon: TrendingUp, station: 'Management' },
        { key: 'raw_data', name: t('raw_data'), href: `/${locale}/data`, icon: Database, station: 'Management' },
        { key: 'finanzas', name: t('finanzas'), href: `/${locale}/finanzas`, icon: Landmark, station: 'Management' },
        { key: 'payroll', name: t('payroll'), href: `/${locale}/payroll`, icon: Clock, station: 'Management' },
        {
            key: 'reports',
            name: t('reports'),
            // No href: clicking Reports expands it, it does not navigate.
            icon: FileBarChart,
            station: 'Management',
            sectionPath: reportsPath,
            children: [
                { name: t('reports_nomina'), href: `${reportsPath}?tab=gastos`, icon: Receipt, isActive: reportsTabIs('gastos') },
                { name: t('reports_archivos'), href: `${reportsPath}?tab=archivos`, icon: Files, isActive: reportsTabIs('archivos') },
            ],
        },
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
                    const Icon = item.icon;

                    // ── Plain link: every item that has no children ──
                    if (!item.children) {
                        const isActive = item.href ? pathname.startsWith(item.href) : false;
                        return (
                            <Link
                                key={item.key}
                                href={item.href ?? '#'}
                                className="sidebar-link-tablet"
                                data-testid={`nav-${item.key}`}
                                data-active={isActive ? 'true' : 'false'}
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
                        );
                    }

                    // ── Expandable section ──
                    const sectionIsCurrent = item.sectionPath ? pathname.startsWith(item.sectionPath) : false;
                    // An explicit click wins; otherwise the current route decides,
                    // so arriving by URL lands with the section already open.
                    const isExpanded = sectionOverrides[item.key] ?? sectionIsCurrent;

                    return (
                        <div key={item.key} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', alignItems: isCollapsed ? 'center' : 'stretch' }} data-testid={`nav-section-${item.key}`} data-expanded={isExpanded ? 'true' : 'false'}>
                            {/* The parent toggles and never navigates, so it is a
                                button rather than a Link — a route it does not go
                                to should not be keyboard-focusable as one. It is
                                also never given the active fill: the CHILD carries
                                that, and two highlights would compete. */}
                            <button
                                onClick={() => setSectionOverrides(s => ({ ...s, [item.key]: !isExpanded }))}
                                aria-expanded={isExpanded}
                                data-testid={`nav-toggle-${item.key}`}
                                title={isCollapsed ? item.name : undefined}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: isCollapsed ? 'center' : 'space-between',
                                    gap: isCollapsed ? '0' : '1rem',
                                    padding: isCollapsed ? '1rem' : '1rem 1.25rem',
                                    borderRadius: '12px',
                                    cursor: 'pointer',
                                    textAlign: 'left',
                                    color: sectionIsCurrent ? 'var(--text-primary)' : 'var(--text-secondary)',
                                    background: 'transparent',
                                    border: 'none',
                                    fontWeight: sectionIsCurrent ? 600 : 500,
                                    fontSize: '1rem',
                                    transition: 'background 0.2s ease, color 0.2s ease',
                                    width: isCollapsed ? '50px' : '100%',
                                }}
                                onMouseOver={(e) => { e.currentTarget.style.background = 'rgba(150, 150, 150, 0.1)'; }}
                                onMouseOut={(e) => { e.currentTarget.style.background = 'transparent'; }}
                            >
                                <span style={{ display: 'flex', alignItems: 'center', gap: isCollapsed ? '0' : '1rem' }}>
                                    <Icon size={20} />
                                    {!isCollapsed && <span className="sidebar-hide-tablet">{item.name}</span>}
                                </span>
                                {!isCollapsed && (
                                    <span className="sidebar-hide-tablet" style={{ display: 'flex' }}>
                                        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                    </span>
                                )}
                            </button>

                            {isExpanded && item.children.map(child => {
                                const ChildIcon = child.icon;
                                const childActive = child.isActive(pathname, searchParams);
                                return (
                                    <Link
                                        key={child.href}
                                        href={child.href}
                                        className="sidebar-link-tablet"
                                        data-testid="nav-child"
                                        data-active={childActive ? 'true' : 'false'}
                                        title={isCollapsed ? child.name : undefined}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: isCollapsed ? 'center' : 'flex-start',
                                            gap: isCollapsed ? '0' : '0.75rem',
                                            // Indented, smaller and never filled edge to
                                            // edge: a child that looked like a top-level
                                            // item would flatten the hierarchy it exists
                                            // to express.
                                            padding: isCollapsed ? '0.7rem' : '0.65rem 1rem 0.65rem 2.6rem',
                                            borderRadius: '10px',
                                            textDecoration: 'none',
                                            fontSize: '0.95rem',
                                            color: childActive ? 'var(--accent-primary)' : 'var(--text-secondary)',
                                            background: childActive ? 'rgba(168, 85, 247, 0.12)' : 'transparent',
                                            fontWeight: childActive ? 600 : 500,
                                            transition: 'background 0.2s ease, color 0.2s ease',
                                            width: isCollapsed ? '44px' : 'auto',
                                        }}
                                        onMouseOver={(e) => {
                                            if (!childActive) {
                                                e.currentTarget.style.background = 'rgba(150, 150, 150, 0.1)';
                                                e.currentTarget.style.color = 'var(--text-primary)';
                                            }
                                        }}
                                        onMouseOut={(e) => {
                                            if (!childActive) {
                                                e.currentTarget.style.background = 'transparent';
                                                e.currentTarget.style.color = 'var(--text-secondary)';
                                            }
                                        }}
                                    >
                                        <ChildIcon size={16} />
                                        {!isCollapsed && <span className="sidebar-hide-tablet">{child.name}</span>}
                                    </Link>
                                );
                            })}
                        </div>
                    );
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
