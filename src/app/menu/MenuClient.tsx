'use client';

import { useEffect, useRef, useState } from 'react';

// Upload logo to Supabase restaurant-assets bucket and paste public URL here.
const LOGO_URL = '';

const THEME_STORAGE_KEY = 'fusionista-menu-theme';

type MenuCategoryData = {
    id: string;
    nameEn: string;
    nameEs: string;
    sortOrder: number;
};

type MenuItemData = {
    id: string;
    name: string;
    nameEs: string | null;
    descriptionEn: string | null;
    descriptionEs: string | null;
    salePrice: number;
    photoUrl: string | null;
    videoUrl: string | null;
    isFeatured: boolean;
    menuCategoryId: string | null;
};

type Lang = 'en' | 'es';
type Theme = 'light' | 'dark';

const UI_TEXT: Record<Lang, { subtitle: string; featured: string; empty: string; itemsOne: string; itemsMany: string }> = {
    en: {
        subtitle: 'Peruvian Kitchen',
        featured: 'Featured',
        empty: 'Menu coming soon.',
        itemsOne: 'dish',
        itemsMany: 'dishes',
    },
    es: {
        subtitle: 'Cocina Peruana',
        featured: 'Destacado',
        empty: 'Menú disponible próximamente.',
        itemsOne: 'plato',
        itemsMany: 'platos',
    },
};

function formatPrice(price: number): string {
    return price % 1 === 0 ? `$${price}` : `$${price.toFixed(2)}`;
}

export default function MenuClient({
    categories,
    items,
}: {
    categories: MenuCategoryData[];
    items: MenuItemData[];
}) {
    const [lang, setLang] = useState<Lang>('es');
    const [theme, setTheme] = useState<Theme>('dark');
    const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
    const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
    const t = UI_TEXT[lang];

    // Read persisted theme after mount (avoids SSR hydration mismatch).
    useEffect(() => {
        const stored = localStorage.getItem(THEME_STORAGE_KEY);
        if (stored === 'light' || stored === 'dark') setTheme(stored);
    }, []);

    // Apply theme by toggling .menu-dark on <body> (which carries .menu-public).
    useEffect(() => {
        document.body.classList.toggle('menu-dark', theme === 'dark');
        localStorage.setItem(THEME_STORAGE_KEY, theme);
    }, [theme]);

    const itemsByCategory = new Map<string, MenuItemData[]>();
    for (const item of items) {
        if (!item.menuCategoryId) continue;
        const list = itemsByCategory.get(item.menuCategoryId) || [];
        list.push(item);
        itemsByCategory.set(item.menuCategoryId, list);
    }
    // Only show categories that actually have available items
    const visibleCategories = categories.filter(c => (itemsByCategory.get(c.id) || []).length > 0);

    useEffect(() => {
        if (visibleCategories.length === 0) return;

        const observer = new IntersectionObserver(
            (entries) => {
                // Pick the topmost visible section as active
                const visible = entries
                    .filter(e => e.isIntersecting)
                    .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
                if (visible.length > 0) {
                    setActiveCategoryId(visible[0].target.getAttribute('data-category-id'));
                }
            },
            // Band just below the sticky nav decides the active section
            { rootMargin: '-15% 0px -70% 0px', threshold: 0 }
        );

        for (const cat of visibleCategories) {
            const el = sectionRefs.current[cat.id];
            if (el) observer.observe(el);
        }
        return () => observer.disconnect();
        // visibleCategories identity changes each render; its ids are stable per data load
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [categories, items]);

    const scrollToCategory = (id: string) => {
        setActiveCategoryId(id);
        sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    const categoryName = (c: MenuCategoryData) => (lang === 'es' ? c.nameEs : c.nameEn);
    const itemName = (i: MenuItemData) => (lang === 'es' ? (i.nameEs || i.name) : i.name);
    const itemDescription = (i: MenuItemData) =>
        lang === 'es' ? (i.descriptionEs || i.descriptionEn) : (i.descriptionEn || i.descriptionEs);

    const renderMedia = (item: MenuItemData, compact = false) => (
        <div className={compact ? 'mp-row-media' : 'mp-media'}>
            {item.videoUrl ? (
                <video
                    className="mp-media-fill"
                    src={item.videoUrl}
                    poster={item.photoUrl || undefined}
                    muted
                    loop
                    playsInline
                    autoPlay
                    preload="none"
                />
            ) : item.photoUrl ? (
                <img
                    className="mp-media-fill"
                    src={item.photoUrl}
                    alt={itemName(item)}
                    loading="lazy"
                />
            ) : (
                <div className="mp-media-placeholder" aria-hidden="true">
                    <span>{itemName(item).charAt(0).toUpperCase()}</span>
                </div>
            )}
            {item.isFeatured && <span className="mp-badge">{t.featured}</span>}
        </div>
    );

    const renderCard = (item: MenuItemData, hero = false) => (
        <article key={item.id} className={`mp-card${hero ? ' mp-card-hero' : ''}`}>
            {renderMedia(item)}
            <div className="mp-card-row">
                <h3 className="mp-item-name">{itemName(item)}</h3>
                <span className="mp-price">{formatPrice(item.salePrice)}</span>
            </div>
            {itemDescription(item) && (
                <p className="mp-item-desc">{itemDescription(item)}</p>
            )}
        </article>
    );

    const renderRow = (item: MenuItemData) => (
        <article key={item.id} className="mp-row">
            {renderMedia(item, true)}
            <div className="mp-row-body">
                <div className="mp-card-row">
                    <h3 className="mp-item-name">{itemName(item)}</h3>
                    <span className="mp-price">{formatPrice(item.salePrice)}</span>
                </div>
                {itemDescription(item) && (
                    <p className="mp-item-desc">{itemDescription(item)}</p>
                )}
            </div>
        </article>
    );

    return (
        <div className="mp-page">
            <header className="mp-header">
                <div>
                    {LOGO_URL ? (
                        <img className="mp-logo-img" src={LOGO_URL} alt="Fusionista" />
                    ) : (
                        <span className="mp-wordmark">FUSIONISTA</span>
                    )}
                </div>
                <div className="mp-header-controls">
                    <div className="mp-lang-toggle" role="group" aria-label="Language / Idioma">
                        <button
                            className={`mp-lang-btn${lang === 'en' ? ' mp-lang-active' : ''}`}
                            onClick={() => setLang('en')}
                            aria-pressed={lang === 'en'}
                        >
                            EN
                        </button>
                        <button
                            className={`mp-lang-btn${lang === 'es' ? ' mp-lang-active' : ''}`}
                            onClick={() => setLang('es')}
                            aria-pressed={lang === 'es'}
                        >
                            ES
                        </button>
                    </div>
                    <button
                        className="mp-theme-btn"
                        onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                        aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                    >
                        {theme === 'dark' ? '☀' : '☾'}
                    </button>
                </div>
            </header>

            {visibleCategories.length === 0 ? (
                <p className="mp-empty">{t.empty}</p>
            ) : (
                <>
                    <nav className="mp-catbar" aria-label="Categories">
                        <div className="mp-catbar-inner">
                            {visibleCategories.map(cat => (
                                <button
                                    key={cat.id}
                                    className={`mp-navlink${activeCategoryId === cat.id ? ' mp-navlink-active' : ''}`}
                                    onClick={() => scrollToCategory(cat.id)}
                                >
                                    {categoryName(cat)}
                                </button>
                            ))}
                        </div>
                    </nav>

                    <main className="mp-main">
                        {visibleCategories.map(cat => {
                            const list = itemsByCategory.get(cat.id) || [];
                            const hero = list.find(i => i.isFeatured) || null;
                            const rest = hero ? list.filter(i => i.id !== hero.id) : list;
                            return (
                                <section
                                    key={cat.id}
                                    className="mp-section"
                                    data-category-id={cat.id}
                                    ref={el => { sectionRefs.current[cat.id] = el; }}
                                >
                                    <div className="mp-section-head">
                                        <h2 className="mp-section-title">{categoryName(cat)}</h2>
                                        <span className="mp-section-count">
                                            {list.length} {list.length === 1 ? t.itemsOne : t.itemsMany}
                                        </span>
                                    </div>
                                    {hero ? (
                                        <div className="mp-feature-grid">
                                            {renderCard(hero, true)}
                                            {rest.length > 0 && (
                                                <div className="mp-rows">
                                                    {rest.map(renderRow)}
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="mp-grid">
                                            {list.map(item => renderCard(item))}
                                        </div>
                                    )}
                                </section>
                            );
                        })}
                    </main>
                </>
            )}
        </div>
    );
}
