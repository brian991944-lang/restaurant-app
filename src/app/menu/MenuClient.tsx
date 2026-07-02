'use client';

import { useEffect, useState } from 'react';

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

const UI_TEXT: Record<Lang, { subtitle: string; featured: string; empty: string; comingSoon: string; itemsOne: string; itemsMany: string }> = {
    en: {
        subtitle: 'Peruvian Kitchen',
        featured: 'Featured',
        empty: 'Menu coming soon.',
        comingSoon: 'Coming soon',
        itemsOne: 'dish',
        itemsMany: 'dishes',
    },
    es: {
        subtitle: 'Cocina Peruana',
        featured: 'Destacado',
        empty: 'Menú disponible próximamente.',
        comingSoon: 'Disponible próximamente',
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
    // Tabbed navigation: one category shown at a time (server orders by sortOrder)
    const [activeCategory, setActiveCategory] = useState<string | null>(categories[0]?.id ?? null);
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

    const selectCategory = (id: string) => {
        setActiveCategory(id);
        window.scrollTo(0, 0);
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

    const currentCategory = categories.find(c => c.id === activeCategory) || null;
    const currentItems = currentCategory ? (itemsByCategory.get(currentCategory.id) || []) : [];
    const hero = currentItems.find(i => i.isFeatured) || null;
    const rest = hero ? currentItems.filter(i => i.id !== hero.id) : currentItems;

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

            {categories.length === 0 ? (
                <p className="mp-empty">{t.empty}</p>
            ) : (
                <>
                    <nav className="mp-catbar" aria-label="Categories">
                        <div className="mp-catbar-inner" role="tablist">
                            {categories.map(cat => (
                                <button
                                    key={cat.id}
                                    role="tab"
                                    aria-selected={activeCategory === cat.id}
                                    className={`mp-navlink${activeCategory === cat.id ? ' mp-navlink-active' : ''}`}
                                    onClick={() => selectCategory(cat.id)}
                                >
                                    {categoryName(cat)}
                                </button>
                            ))}
                        </div>
                    </nav>

                    {currentCategory && (
                        <main className="mp-main">
                            {/* key remounts the section per tab so the opacity fade replays */}
                            <section key={currentCategory.id} className="mp-section mp-section-fade">
                                <div className="mp-section-head">
                                    <h2 className="mp-section-title">{categoryName(currentCategory)}</h2>
                                    {currentItems.length > 0 && (
                                        <span className="mp-section-count">
                                            {currentItems.length} {currentItems.length === 1 ? t.itemsOne : t.itemsMany}
                                        </span>
                                    )}
                                </div>
                                {currentItems.length === 0 ? (
                                    <p className="mp-comingsoon">{t.comingSoon}</p>
                                ) : hero ? (
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
                                        {currentItems.map(item => renderCard(item))}
                                    </div>
                                )}
                            </section>
                        </main>
                    )}
                </>
            )}
        </div>
    );
}
