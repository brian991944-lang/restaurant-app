'use client';

import { useEffect, useRef, useState } from 'react';

// Upload logo to Supabase restaurant-assets bucket and paste public URL here.
const LOGO_URL = '';

const THEME_STORAGE_KEY = 'fusionista-menu-theme';

// Runs while the HTML is still parsing (before first paint) so the body class
// matches the visitor's stored theme even though layout.tsx pre-applies
// menu-dark. Default (nothing stored) is light.
const THEME_SYNC_SCRIPT = `try{document.body.classList.toggle('menu-dark',localStorage.getItem('${THEME_STORAGE_KEY}')==='dark')}catch(e){}`;

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
    taglineEn: string | null;
    taglineEs: string | null;
    salePrice: number;
    photoUrl: string | null;
    photoUrls: string[];
    videoUrl: string | null;
    isFeatured: boolean;
    menuCategoryId: string | null;
};

type Lang = 'en' | 'es';
type Theme = 'light' | 'dark';
type MediaTab = 'fotos' | 'video';

const UI_TEXT: Record<Lang, {
    subtitle: string; featured: string; empty: string; comingSoon: string;
    itemsOne: string; itemsMany: string; photosTab: string; videoTab: string;
    close: string; view: string; prevPhoto: string; nextPhoto: string;
}> = {
    en: {
        subtitle: 'Peruvian Kitchen',
        featured: 'Featured',
        empty: 'Menu coming soon.',
        comingSoon: 'Coming soon',
        itemsOne: 'dish',
        itemsMany: 'dishes',
        photosTab: 'PHOTOS',
        videoTab: 'VIDEO',
        close: 'Close',
        view: 'View',
        prevPhoto: 'Previous photo',
        nextPhoto: 'Next photo',
    },
    es: {
        subtitle: 'Cocina Peruana',
        featured: 'Destacado',
        empty: 'Menú disponible próximamente.',
        comingSoon: 'Disponible próximamente',
        itemsOne: 'plato',
        itemsMany: 'platos',
        photosTab: 'FOTOS',
        videoTab: 'VIDEO',
        close: 'Cerrar',
        view: 'Ver',
        prevPhoto: 'Foto anterior',
        nextPhoto: 'Foto siguiente',
    },
};

function formatPrice(price: number): string {
    return price % 1 === 0 ? `$${price}` : `$${price.toFixed(2)}`;
}

// Lightbox gallery: cover first, then extra photos, deduped, nulls removed.
function galleryOf(item: MenuItemData): string[] {
    return Array.from(new Set([item.photoUrl, ...(item.photoUrls || [])].filter((u): u is string => !!u)));
}

function hasMedia(item: MenuItemData): boolean {
    return galleryOf(item).length > 0 || !!item.videoUrl;
}

const PlayGlyph = ({ size = 10 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true">
        <path d="M1 0 L10 5 L1 10 Z" fill="currentColor" />
    </svg>
);

export default function MenuClient({
    categories,
    items,
}: {
    categories: MenuCategoryData[];
    items: MenuItemData[];
}) {
    const [lang, setLang] = useState<Lang>('en');
    const [theme, setTheme] = useState<Theme>('light');
    // Tabbed navigation: one category shown at a time (server orders by sortOrder)
    const [activeCategory, setActiveCategory] = useState<string | null>(categories[0]?.id ?? null);

    // Dish lightbox
    const [selected, setSelected] = useState<MenuItemData | null>(null);
    const [mediaTab, setMediaTab] = useState<MediaTab>('fotos');
    const [photoIndex, setPhotoIndex] = useState(0);
    const touchStartX = useRef<number | null>(null);

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

    // Lightbox: lock body scroll + close on Escape while open.
    useEffect(() => {
        if (!selected) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setSelected(null);
        };
        window.addEventListener('keydown', onKey);
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            window.removeEventListener('keydown', onKey);
            document.body.style.overflow = prevOverflow;
        };
    }, [selected]);

    const openLightbox = (item: MenuItemData) => {
        setSelected(item);
        setPhotoIndex(0);
        // Items with video but no photos open directly on VIDEO.
        setMediaTab(galleryOf(item).length > 0 ? 'fotos' : 'video');
    };

    const closeLightbox = () => setSelected(null);

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
    const itemTagline = (i: MenuItemData) =>
        lang === 'es' ? (i.taglineEs || i.taglineEn) : (i.taglineEn || i.taglineEs);

    const renderMedia = (item: MenuItemData, compact = false) => {
        const cover = item.photoUrl || (item.photoUrls || [])[0] || null;
        const clickable = hasMedia(item);
        const interactiveProps = clickable
            ? {
                role: 'button' as const,
                tabIndex: 0,
                'aria-label': `${t.view} ${itemName(item)}`,
                onClick: () => openLightbox(item),
                onKeyDown: (e: React.KeyboardEvent) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openLightbox(item);
                    }
                },
            }
            : {};
        return (
            <div
                className={`${compact ? 'mp-row-media' : 'mp-media'}${clickable ? ' mp-media-tappable' : ''}`}
                {...interactiveProps}
            >
                {cover ? (
                    <img
                        className="mp-media-fill"
                        src={cover}
                        alt={itemName(item)}
                        loading="lazy"
                    />
                ) : (
                    <div className="mp-media-placeholder" aria-hidden="true">
                        <span>{itemName(item).charAt(0).toUpperCase()}</span>
                    </div>
                )}
                {item.videoUrl && (
                    <span className="mp-play-badge" aria-hidden="true">
                        <PlayGlyph size={12} />
                    </span>
                )}
                {item.isFeatured && <span className="mp-badge">{t.featured}</span>}
            </div>
        );
    };

    const renderCard = (item: MenuItemData, hero = false) => (
        <article key={item.id} className={`mp-card${hero ? ' mp-card-hero' : ''}`}>
            {renderMedia(item)}
            <div className="mp-card-row mp-card-row-tappable" onClick={() => openLightbox(item)}>
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
                <div className="mp-card-row mp-card-row-tappable" onClick={() => openLightbox(item)}>
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

    const renderLightbox = () => {
        if (!selected) return null;
        const gallery = galleryOf(selected);
        const showTabs = gallery.length > 0 && !!selected.videoUrl;
        const tagline = itemTagline(selected);
        const desc = itemDescription(selected);
        const showPhotos = mediaTab === 'fotos' && gallery.length > 0;
        const showVideo = mediaTab === 'video' && !!selected.videoUrl;

        const prevPhoto = () => setPhotoIndex(i => (i - 1 + gallery.length) % gallery.length);
        const nextPhoto = () => setPhotoIndex(i => (i + 1) % gallery.length);

        return (
            <div
                className="mp-lightbox"
                role="dialog"
                aria-modal="true"
                aria-label={itemName(selected)}
                onClick={closeLightbox}
            >
                <button className="mp-lb-close" onClick={(e) => { e.stopPropagation(); closeLightbox(); }} aria-label={t.close}>
                    ✕
                </button>
                <div className="mp-lb-content" onClick={(e) => e.stopPropagation()}>
                    <h2 className="mp-lb-name">{itemName(selected)}</h2>
                    <div className="mp-lb-price">{formatPrice(selected.salePrice)}</div>

                    {showTabs && (
                        <div className="mp-lb-tabs" role="tablist">
                            <button
                                role="tab"
                                aria-selected={mediaTab === 'fotos'}
                                className={`mp-lb-tab${mediaTab === 'fotos' ? ' mp-lb-tab-active' : ''}`}
                                onClick={() => setMediaTab('fotos')}
                            >
                                {t.photosTab}
                            </button>
                            <button
                                role="tab"
                                aria-selected={mediaTab === 'video'}
                                className={`mp-lb-tab${mediaTab === 'video' ? ' mp-lb-tab-active' : ''}`}
                                onClick={() => setMediaTab('video')}
                            >
                                <PlayGlyph size={9} />
                                {t.videoTab}
                            </button>
                        </div>
                    )}

                    {showPhotos && (
                        <>
                            <div
                                className="mp-lb-media"
                                onTouchStart={(e) => { touchStartX.current = e.touches[0].clientX; }}
                                onTouchEnd={(e) => {
                                    if (touchStartX.current === null) return;
                                    const dx = e.changedTouches[0].clientX - touchStartX.current;
                                    touchStartX.current = null;
                                    if (Math.abs(dx) > 40 && gallery.length > 1) {
                                        if (dx < 0) nextPhoto(); else prevPhoto();
                                    }
                                }}
                            >
                                {/* key remount replays the opacity-only fade between photos */}
                                <img
                                    key={photoIndex}
                                    className="mp-lb-photo"
                                    src={gallery[photoIndex]}
                                    alt={`${itemName(selected)} ${photoIndex + 1}/${gallery.length}`}
                                />
                                {gallery.length > 1 && (
                                    <>
                                        <button className="mp-lb-chevron mp-lb-chevron-left" onClick={prevPhoto} aria-label={t.prevPhoto}>
                                            <svg width="9" height="14" viewBox="0 0 9 14" aria-hidden="true"><path d="M8 1 L2 7 L8 13" stroke="currentColor" strokeWidth="1.6" fill="none" /></svg>
                                        </button>
                                        <button className="mp-lb-chevron mp-lb-chevron-right" onClick={nextPhoto} aria-label={t.nextPhoto}>
                                            <svg width="9" height="14" viewBox="0 0 9 14" aria-hidden="true"><path d="M1 1 L7 7 L1 13" stroke="currentColor" strokeWidth="1.6" fill="none" /></svg>
                                        </button>
                                    </>
                                )}
                            </div>
                            {gallery.length > 1 && (
                                <div className="mp-lb-dots">
                                    {gallery.map((_, i) => (
                                        <button
                                            key={i}
                                            className={`mp-lb-dot${i === photoIndex ? ' mp-lb-dot-active' : ''}`}
                                            onClick={() => setPhotoIndex(i)}
                                            aria-label={`${i + 1}/${gallery.length}`}
                                        />
                                    ))}
                                </div>
                            )}
                        </>
                    )}

                    {/* Conditional mount: switching tabs or closing unmounts the
                        <video>, which stops playback and audio. */}
                    {showVideo && (
                        <div className="mp-lb-media">
                            <video
                                className="mp-lb-video"
                                src={selected.videoUrl!}
                                poster={gallery[0] || undefined}
                                autoPlay
                                muted
                                loop
                                playsInline
                                controls
                                preload="auto"
                            />
                        </div>
                    )}

                    {tagline && <p className="mp-lb-tagline">{tagline}</p>}
                    {desc && <p className="mp-lb-desc">{desc}</p>}
                </div>
            </div>
        );
    };

    return (
        <div className="mp-page">
            {/* Pre-paint theme sync: corrects the menu-dark class layout.tsx ships
                before the page paints (light is the default when nothing stored). */}
            <script dangerouslySetInnerHTML={{ __html: THEME_SYNC_SCRIPT }} />
            <header className="mp-header">
                {LOGO_URL ? (
                    <img className="mp-logo-img" src={LOGO_URL} alt="Fusionista" />
                ) : (
                    <span className="mp-wordmark">FUSIONISTA</span>
                )}
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

            {renderLightbox()}
        </div>
    );
}
