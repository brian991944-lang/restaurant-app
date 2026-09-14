'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { MENU_TAGS } from '@/lib/menuTags';
import { MENU_GLOSSARY } from '@/lib/menuGlossary';

const THEME_STORAGE_KEY = 'fusionista-menu-theme';

// Runs while the HTML is still parsing (before first paint) so the body class
// matches the visitor's stored theme even though layout.tsx pre-applies
// menu-dark. Default (nothing stored) is light.
const THEME_SYNC_SCRIPT = `try{document.body.classList.toggle('menu-dark',localStorage.getItem('${THEME_STORAGE_KEY}')==='dark')}catch(e){}`;

type MenuCategoryData = {
    id: string;
    nameEn: string;
    nameEs: string;
    subtitleEn: string | null;
    subtitleEs: string | null;
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
    tags: string[];
    whyEn: string | null;
    whyEs: string | null;
    componentsEn: string[];
    componentsEs: string[];
    salePrice: number;
    photoUrl: string | null;
    photoUrls: string[];
    photoFocalX: number;
    photoFocalY: number;
    photoZoom: number;
    photoFit: string;
    videoUrl: string | null;
    isFeatured: boolean;
    featuredRank: number | null;
    menuCategoryId: string | null;
};

type Lang = 'en' | 'es';
type Theme = 'light' | 'dark';
type MediaTab = 'fotos' | 'video';

const UI_TEXT: Record<Lang, {
    empty: string; comingSoon: string; photosTab: string; videoTab: string;
    close: string; view: string; prevPhoto: string; nextPhoto: string;
    hint: string; seeMore: string; favorite: string; glossaryTitle: string;
    footerTitle: string; footerSub: string;
}> = {
    en: {
        empty: 'Menu coming soon.',
        comingSoon: 'Coming soon',
        photosTab: 'PHOTOS',
        videoTab: 'VIDEO',
        close: 'Close',
        view: 'View',
        prevPhoto: 'Previous photo',
        nextPhoto: 'Next photo',
        hint: 'Look at the photos, read what each dish is, then call your server. This menu does not send orders.',
        seeMore: 'See more and why order this',
        favorite: 'Favorite',
        glossaryTitle: 'Words that help',
        footerTitle: 'Ready to order? Call your server',
        footerSub: 'Your server takes the order',
    },
    es: {
        empty: 'Menú disponible próximamente.',
        comingSoon: 'Disponible próximamente',
        photosTab: 'FOTOS',
        videoTab: 'VIDEO',
        close: 'Cerrar',
        view: 'Ver',
        prevPhoto: 'Foto anterior',
        nextPhoto: 'Foto siguiente',
        hint: 'Mira las fotos, lee qué es cada plato y llama al mesero cuando quieras pedir. Este menú no envía órdenes.',
        seeMore: 'Ver más y por qué pedirlo',
        favorite: 'Favorito',
        glossaryTitle: 'Palabras que ayudan',
        footerTitle: '¿Listo para pedir? Llama al mesero',
        footerSub: 'El mesero toma tu orden',
    },
};

function formatPrice(price: number): string {
    return price % 1 === 0 ? `$${price}` : `$${price.toFixed(2)}`;
}

// Card prices carry no dollar sign (design); the lightbox keeps formatPrice's "$".
function formatPriceBare(price: number): string {
    return formatPrice(price).slice(1);
}

// Lightbox gallery: cover first, then extra photos, deduped, nulls removed.
function galleryOf(item: MenuItemData): string[] {
    return Array.from(new Set([item.photoUrl, ...(item.photoUrls || [])].filter((u): u is string => !!u)));
}

function hasMedia(item: MenuItemData): boolean {
    return galleryOf(item).length > 0 || !!item.videoUrl;
}

// Card cover precedence: cover photo, else first gallery photo.
function coverOf(item: MenuItemData): string | null {
    return item.photoUrl || (item.photoUrls || [])[0] || null;
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

    // prefers-reduced-motion: the featured video is replaced by its poster.
    // Tracked in JS (not CSS display) so the <video> is never mounted at all —
    // a hidden autoplaying video would still download and play.
    const [reducedMotion, setReducedMotion] = useState(false);
    useEffect(() => {
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        setReducedMotion(mq.matches);
        const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
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

    // Tag chip label in the active language; unknown keys render nothing.
    const tagLabel = (key: string): string | null => {
        const tag = MENU_TAGS.find(tg => tg.key === key);
        return tag ? (lang === 'es' ? tag.es : tag.en) : null;
    };

    // One card component, two variants sharing ONE media element. Both honor
    // photoFit / photoZoom / the focal point via mediaStyle (left/top pan math —
    // no transform, per this module's hard rules). Featured differs only in
    // size (full-row banner, taller media, gold frame — all CSS) and in
    // playing its video inline when reduced motion is off.
    const renderCard = (item: MenuItemData, opts?: { featured: boolean }) => {
        const featured = opts?.featured ?? false;
        const cover = coverOf(item);
        const desc = itemDescription(item);
        const fit: 'cover' | 'contain' = item.photoFit === 'contain' ? 'contain' : 'cover';
        const zoom = item.photoZoom;
        const mediaStyle: React.CSSProperties = {
            objectFit: fit,
            objectPosition: `${item.photoFocalX}% ${item.photoFocalY}%`,
            width: `${zoom}%`,
            height: `${zoom}%`,
            left: `${-(zoom - 100) * (item.photoFocalX / 100)}%`,
            top: `${-(zoom - 100) * (item.photoFocalY / 100)}%`,
        };
        const clickable = hasMedia(item);
        // Video only on the featured variant; grid cards always show the photo.
        const showVideo = featured && !!item.videoUrl && !reducedMotion;
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
            <article key={item.id} className={`mp-card${featured ? ' mp-card-feat' : ''}`}>
                <div
                    className={`mp-cardmedia${fit === 'contain' ? ' mp-feat-tile-textile' : ''}${clickable ? ' mp-media-tappable' : ''}`}
                    {...interactiveProps}
                >
                    {showVideo ? (
                        <video
                            className="mp-cardmedia-fill"
                            src={item.videoUrl!}
                            poster={cover || undefined}
                            autoPlay
                            muted
                            loop
                            playsInline
                            preload="auto"
                            style={mediaStyle}
                        />
                    ) : cover ? (
                        <img
                            className="mp-cardmedia-fill"
                            src={cover}
                            alt={itemName(item)}
                            loading="lazy"
                            style={mediaStyle}
                        />
                    ) : (
                        <div className="mp-media-placeholder" aria-hidden="true">
                            <span>{itemName(item).charAt(0).toUpperCase()}</span>
                        </div>
                    )}
                    {item.videoUrl && !showVideo && (
                        <span className="mp-play-badge" aria-hidden="true">
                            <PlayGlyph size={12} />
                        </span>
                    )}
                </div>
                <div className="mp-card-body">
                    <div className="mp-card-row mp-card-row-tappable" onClick={() => openLightbox(item)}>
                        <h3 className="mp-item-name">{itemName(item)}</h3>
                        <span className="mp-price">{formatPriceBare(item.salePrice)}</span>
                    </div>
                    {desc && <p className="mp-item-desc">{desc}</p>}
                    {(featured || item.tags.length > 0) && (
                        <div className="mp-tags">
                            {featured && <span className="mp-tag mp-tag-fav">{t.favorite}</span>}
                            {item.tags.map(key => {
                                const label = tagLabel(key);
                                return label ? (
                                    <span key={key} className={`mp-tag mp-tag-${key}`}>{label}</span>
                                ) : null;
                            })}
                        </div>
                    )}
                    <button className="mp-seemore" onClick={() => openLightbox(item)}>
                        {t.seeMore}
                    </button>
                </div>
            </article>
        );
    };

    const currentCategory = categories.find(c => c.id === activeCategory) || null;
    const currentItems = currentCategory ? (itemsByCategory.get(currentCategory.id) || []) : [];

    // Featured: this category's ranked items that have a cover photo, lowest
    // rank first, capped at 2. A rank without an image is skipped (never blank).
    // Featured dishes render as the FIRST cards in the grid and are removed
    // from the regular list so no dish appears twice.
    const featured = currentItems
        .filter(i => i.featuredRank != null && !!coverOf(i))
        .sort((a, b) => (a.featuredRank as number) - (b.featuredRank as number))
        .slice(0, 2);
    const featuredIds = new Set(featured.map(i => i.id));
    const regularItems = currentItems.filter(i => !featuredIds.has(i.id));

    // Category subtitle in the active language only — no cross-language fallback.
    const sectionLead = currentCategory
        ? (lang === 'es' ? currentCategory.subtitleEs : currentCategory.subtitleEn)?.trim() || null
        : null;

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

            {/* Header + category nav share ONE sticky container so they scroll
                as a unit — no separate sticky offsets. */}
            <div className="mp-sticky">
                <header className="mp-header">
                    <div className="mp-header-row">
                        <img
                            className="mp-logo-img"
                            src="/menu/logo.png"
                            alt="Fusionista — Modern Peruvian Cuisine"
                        />
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
                    </div>
                    <p className="mp-hint">{t.hint}</p>
                </header>

                {categories.length > 0 && (
                    <nav className="mp-catbar" aria-label="Categories">
                        {categories.map(cat => (
                            <button
                                key={cat.id}
                                aria-pressed={activeCategory === cat.id}
                                className={`mp-pill${activeCategory === cat.id ? ' mp-pill-active' : ''}`}
                                onClick={() => selectCategory(cat.id)}
                            >
                                {categoryName(cat)}
                            </button>
                        ))}
                    </nav>
                )}
            </div>

            {categories.length === 0 ? (
                <p className="mp-empty">{t.empty}</p>
            ) : (
                currentCategory && (
                    <main className="mp-main">
                        {/* key remounts the section per tab so the opacity fade replays */}
                        <section key={currentCategory.id} className="mp-section-fade">
                            <h2 className="mp-section-title">{categoryName(currentCategory)}</h2>
                            {sectionLead && <p className="mp-section-lead">{sectionLead}</p>}
                            {currentItems.length === 0 ? (
                                <p className="mp-comingsoon">{t.comingSoon}</p>
                            ) : (
                                <div className="mp-grid">
                                    {featured.map(item => renderCard(item, { featured: true }))}
                                    {regularItems.map(item => renderCard(item))}
                                </div>
                            )}
                        </section>
                    </main>
                )
            )}

            <aside className="mp-glossary">
                <h2 className="mp-glossary-title">{t.glossaryTitle}</h2>
                <dl>
                    {MENU_GLOSSARY.map(g => (
                        <Fragment key={g.term}>
                            <dt>{g.term}</dt>
                            <dd>{lang === 'es' ? g.es : g.en}</dd>
                        </Fragment>
                    ))}
                </dl>
            </aside>

            <footer className="mp-footer">
                <strong className="mp-footer-title">{t.footerTitle}</strong>
                <span className="mp-footer-sub">{t.footerSub}</span>
            </footer>

            {renderLightbox()}
        </div>
    );
}
