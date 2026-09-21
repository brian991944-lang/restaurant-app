'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { MENU_TAGS } from '@/lib/menuTags';
import { MENU_GLOSSARY } from '@/lib/menuGlossary';
import { coverOf, hasMedia, photosOf, type MediaVariant } from './offline/media';
import { useOfflineMenu } from './offline/useOfflineMenu';
import StaffPanel, { formatClock } from './offline/StaffPanel';
import type { MenuCategoryData, MenuItemData, SyncState } from './offline/types';

const THEME_STORAGE_KEY = 'fusionista-menu-theme';

// Runs while the HTML is still parsing (before first paint) so the body class
// matches the visitor's stored theme even though layout.tsx pre-applies
// menu-dark. Default (nothing stored) is light.
const THEME_SYNC_SCRIPT = `try{document.body.classList.toggle('menu-dark',localStorage.getItem('${THEME_STORAGE_KEY}')==='dark')}catch(e){}`;

// MenuCategoryData / MenuItemData live in ./offline/types so the server page,
// this component and the offline snapshot agree on one shape.

type Lang = 'en' | 'es';
type Theme = 'light' | 'dark';
type MediaTab = 'fotos' | 'video';

const UI_TEXT: Record<Lang, {
    empty: string; comingSoon: string; photosTab: string; videoTab: string;
    close: string; view: string; prevPhoto: string; nextPhoto: string;
    photoSoon: string; houseFavorite: string; glossaryTitle: string; soldOut: string;
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
        photoSoon: 'Photo coming soon',
        houseFavorite: 'House favorite',
        glossaryTitle: 'Words that help',
        soldOut: 'Sold out',
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
        photoSoon: 'Foto próximamente',
        houseFavorite: 'Favorito de la casa',
        glossaryTitle: 'Palabras que ayudan',
        soldOut: 'Agotado',
    },
};

// Freshness line for the installed app (Spanish: it is read by the floor
// team, not guests). Plain about being offline: a server must be able to tell
// at a glance whether "Actualizado 9:14 AM" is still being refreshed.
function syncLineOf(sync: SyncState | null): { text: string; offline: boolean } | null {
    if (!sync || !sync.loaded) return null;
    const updated = sync.lastSyncAt ? `Actualizado ${formatClock(sync.lastSyncAt)}` : 'Menú aún no sincronizado';
    const offline = !sync.online || !!sync.offlineSince;
    if (offline) {
        const since = sync.offlineSince ?? sync.lastAttemptAt;
        const sinceText = since ? ` desde ${formatClock(since)}` : '';
        return {
            text: `Sin conexión${sinceText} · ${sync.lastSyncAt ? `última actualización ${formatClock(sync.lastSyncAt)}` : 'sin menú sincronizado'}`,
            offline: true,
        };
    }
    return { text: sync.syncing && !sync.lastSyncAt ? 'Actualizando…' : updated, offline: false };
}

const STAFF_TAPS = 5;
const STAFF_TAP_WINDOW_MS = 2000;

function formatPrice(price: number): string {
    return price % 1 === 0 ? `$${price}` : `$${price.toFixed(2)}`;
}

// Card prices carry no dollar sign (design); the lightbox keeps formatPrice's "$".
function formatPriceBare(price: number): string {
    return formatPrice(price).slice(1);
}

// Photo URLs come from ./offline/media, which resolves each photo's web/full
// pair. Which variant this launch uses is decided once, below, from
// `standalone` — the installed iPads get full-res, a phone browser gets the
// web copy. Nothing else in this file touches photoUrl/photoUrlFull directly.

const PlayGlyph = ({ size = 10 }: { size?: number }) => (
    <svg width={size} height={size} viewBox="0 0 10 10" aria-hidden="true">
        <path d="M1 0 L10 5 L1 10 Z" fill="currentColor" />
    </svg>
);

// Outline only — it sits in the empty photo frame and must not compete with
// the dishes that do have one.
const CameraGlyph = () => (
    <svg width="34" height="28" viewBox="0 0 34 28" fill="none" aria-hidden="true">
        <rect x="1" y="6" width="32" height="21" rx="3" stroke="currentColor" strokeWidth="1.1" />
        <path d="M11 6 L13.5 1.5 H20.5 L23 6" stroke="currentColor" strokeWidth="1.1" />
        <circle cx="17" cy="16.5" r="6.5" stroke="currentColor" strokeWidth="1.1" />
    </svg>
);

// Andean step band. Drawn as a tiling <pattern> at its natural 44px rather
// than one stretched path, so the steps stay square whatever the content width
// is — a viewBox scaled to fit would shear them on a wide iPad.
const Greca = () => (
    <svg className="mp-greca" height="14" aria-hidden="true">
        <defs>
            <pattern id="mp-greca-tile" width="44" height="14" patternUnits="userSpaceOnUse">
                <path
                    d="M0 12 H6 V6 H17 V2 H27 V6 H38 V12 H44"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.1"
                />
            </pattern>
        </defs>
        <rect width="100%" height="14" fill="url(#mp-greca-tile)" />
    </svg>
);

/**
 * Faint suns drifting behind the page.
 *
 * One fixed pattern that repeats every SUN_CYCLE px down the page, so every
 * category is furnished without anyone hand-placing art per category — and
 * because the cycle is much taller than a screen, two screens rarely show the
 * same arrangement. Negative and past-100% lefts are deliberate: .mp-suns
 * clips them, which is what crops a sun against the page edge.
 *
 * No rotation — the module bans transform, and a tilted sun would fight the
 * upright type anyway.
 */
const SUN_PATTERN: { top: number; left: string; size: number; tone: 'a' | 'b' | 'c' }[] = [
    { top: 40, left: '-7%', size: 300, tone: 'b' },
    { top: 430, left: '63%', size: 240, tone: 'a' },
    { top: 840, left: '14%', size: 380, tone: 'c' },
    { top: 1290, left: '78%', size: 260, tone: 'b' },
    { top: 1660, left: '-9%', size: 340, tone: 'a' },
    { top: 2060, left: '40%', size: 250, tone: 'c' },
];
const SUN_CYCLE = 2450;
const SUN_REPEATS = 6;

export default function MenuClient({
    categories: serverCategories,
    items: serverItems,
}: {
    categories: MenuCategoryData[];
    items: MenuItemData[];
}) {
    // Installed app: categories/items come from the IndexedDB snapshot as soon
    // as it is read (offline-capable, never waits for the network). Normal
    // browser tab: the server props, untouched.
    const { categories, items, standalone, sync, syncNow } = useOfflineMenu({
        categories: serverCategories,
        items: serverItems,
    });
    const [lang, setLang] = useState<Lang>('en');
    const [theme, setTheme] = useState<Theme>('light');
    // Tabbed navigation: one category shown at a time (server orders by sortOrder)
    const [activeCategory, setActiveCategory] = useState<string | null>(categories[0]?.id ?? null);

    // A sync can replace the category list; never leave the tab pointing at a
    // category that no longer exists.
    useEffect(() => {
        if (activeCategory && categories.some(c => c.id === activeCategory)) return;
        setActiveCategory(categories[0]?.id ?? null);
    }, [categories, activeCategory]);

    // Staff panel: five quick taps on the logo, installed app only.
    const [staffOpen, setStaffOpen] = useState(false);
    const staffTaps = useRef<number[]>([]);
    const onLogoTap = () => {
        if (!standalone) return;
        const now = Date.now();
        staffTaps.current = [...staffTaps.current.filter(t => now - t < STAFF_TAP_WINDOW_MS), now];
        if (staffTaps.current.length >= STAFF_TAPS) {
            staffTaps.current = [];
            setStaffOpen(true);
        }
    };
    const syncLine = standalone ? syncLineOf(sync) : null;

    // Which stored copy of every photo this launch shows. The installed iPads
    // (standalone) are on the house wifi with a cache warmed to match, so they
    // take the full-res copy; every browser tab takes the web copy. Read from
    // the same `standalone` the sync engine is gated on, so the launch that
    // caches full-res is exactly the launch that displays it.
    const mediaVariant: MediaVariant = standalone ? 'full' : 'web';

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
        setMediaTab(photosOf(item, mediaVariant).length > 0 ? 'fotos' : 'video');
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
    // `name` is Clover-owned on linked rows, so the app-owned nameEn wins when
    // set. Spanish falls back through nameEn before the raw Clover name.
    const itemName = (i: MenuItemData) =>
        (lang === 'es' ? (i.nameEs || i.nameEn || i.name) : (i.nameEn || i.name));
    const itemDescription = (i: MenuItemData) =>
        lang === 'es' ? (i.descriptionEs || i.descriptionEn) : (i.descriptionEn || i.descriptionEs);
    const itemTagline = (i: MenuItemData) =>
        lang === 'es' ? (i.taglineEs || i.taglineEn) : (i.taglineEn || i.taglineEs);

    // Tag chip label in the active language; unknown keys render nothing.
    const tagLabel = (key: string): string | null => {
        const tag = MENU_TAGS.find(tg => tg.key === key);
        return tag ? (lang === 'es' ? tag.es : tag.en) : null;
    };

    /**
     * The photo box, shared by every context a dish photo appears in.
     *
     * The fit maths is the part that must not drift: "Rellenar" is cover plus
     * the admin's focal point and zoom, expressed as width/height/left/top pan
     * rather than a transform (banned in this module), and "Foto completa" is
     * contain with the dish's own blurred photo filling the letterbox behind
     * it. Nothing here ever stretches a photo.
     *
     * `video` is passed only by favorites — inline autoplay belongs to them
     * alone, and reduced-motion falls back to the still.
     */
    const renderShot = (item: MenuItemData, opts: { video: boolean }) => {
        const cover = coverOf(item, mediaVariant);
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
        const showVideo = opts.video && !!item.videoUrl && !reducedMotion;
        return (
            <div className="mp-shot">
                {/* Blurred duplicate of the cover, behind the sharp media by DOM
                    order. A cover-fit photo hides it; a contain-fit one shows it
                    exactly where the letterbox would otherwise be flat colour. */}
                {cover && (
                    <img className="mp-shot-blur" src={cover} alt="" aria-hidden="true" loading="lazy" />
                )}
                {showVideo ? (
                    <video
                        className="mp-shot-fill"
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
                        className="mp-shot-fill"
                        src={cover}
                        alt={itemName(item)}
                        loading="lazy"
                        style={mediaStyle}
                    />
                ) : (
                    // Every dish has a photo slot; this is the slot waiting.
                    <div className="mp-noshot">
                        <CameraGlyph />
                        <span className="mp-noshot-text">{t.photoSoon}</span>
                    </div>
                )}
                {item.videoUrl && !showVideo && (
                    <span className="mp-play-badge" aria-hidden="true">
                        <PlayGlyph size={12} />
                    </span>
                )}
            </div>
        );
    };

    // Opens the lightbox from the frame. Only dishes with something to show
    // are interactive, so a placeholder is never a dead button.
    const tapProps = (item: MenuItemData) =>
        hasMedia(item)
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

    // A dish on the page: no card, no box, no shadow. The gold mat is the only
    // edge, and only in daylight (see .mp-frame).
    const renderDish = (item: MenuItemData) => {
        const desc = itemDescription(item);
        const soldOut = item.soldOut === true;
        const clickable = hasMedia(item);
        return (
            <article key={item.id} className={`mp-dish${soldOut ? ' mp-dish-soldout' : ''}`}>
                <div className={`mp-frame${clickable ? ' mp-media-tappable' : ''}`} {...tapProps(item)}>
                    {renderShot(item, { video: false })}
                </div>
                <div className={`mp-dish-row${clickable ? ' mp-dish-row-tappable' : ''}`} onClick={clickable ? () => openLightbox(item) : undefined}>
                    <h3 className="mp-dish-name">{itemName(item)}</h3>
                    <span>
                        <span className="mp-price">{formatPriceBare(item.salePrice)}</span>
                        {soldOut && <span className="mp-soldout">{t.soldOut}</span>}
                    </span>
                </div>
                {desc && <p className="mp-dish-desc">{desc}</p>}
                {item.tags.length > 0 && (
                    <div className="mp-tags">
                        {item.tags.map(key => {
                            const label = tagLabel(key);
                            return label ? <span key={key} className="mp-tag">{label}</span> : null;
                        })}
                    </div>
                )}
            </article>
        );
    };

    // A house favorite. Same photo element, a gold edge with the bloom around
    // it, and the label above a larger name. One runs the content width; two
    // stand side by side in tall frames (the aspect comes from .mp-favs-N).
    const renderFavorite = (item: MenuItemData) => {
        const desc = itemDescription(item);
        const soldOut = item.soldOut === true;
        return (
            <article key={item.id} className={`mp-fav${soldOut ? ' mp-dish-soldout' : ''}`}>
                <div className="mp-fav-frame mp-media-tappable" {...tapProps(item)}>
                    {renderShot(item, { video: true })}
                </div>
                <p className="mp-fav-label">{t.houseFavorite}</p>
                <div className="mp-dish-row mp-dish-row-tappable" onClick={() => openLightbox(item)}>
                    <h3 className="mp-fav-name">{itemName(item)}</h3>
                    <span>
                        <span className="mp-price">{formatPriceBare(item.salePrice)}</span>
                        {soldOut && <span className="mp-soldout">{t.soldOut}</span>}
                    </span>
                </div>
                {desc && <p className="mp-dish-desc">{desc}</p>}
                {item.tags.length > 0 && (
                    <div className="mp-tags">
                        {item.tags.map(key => {
                            const label = tagLabel(key);
                            return label ? <span key={key} className="mp-tag">{label}</span> : null;
                        })}
                    </div>
                )}
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
        .filter(i => i.featuredRank != null && !!coverOf(i, mediaVariant))
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
        const gallery = photosOf(selected, mediaVariant);
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
                    <div className="mp-lb-price">
                        {formatPrice(selected.salePrice)}
                        {selected.soldOut === true && <span className="mp-soldout">{t.soldOut}</span>}
                    </div>

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

            {/* Dark strip behind the translucent status bar. Height collapses to
                zero wherever safe-area-inset-top is 0 — i.e. every browser tab —
                so this is inert for guests. See .mp-statusbar-scrim in menu.css. */}
            <div className="mp-statusbar-scrim" aria-hidden="true" />

            {/* Decorative only: behind every layer of content, never hit-tested.
                See SUN_PATTERN above for why the positions repeat. */}
            <div className="mp-suns" aria-hidden="true">
                {Array.from({ length: SUN_REPEATS }).flatMap((_, cycle) =>
                    SUN_PATTERN.map((sun, n) => (
                        <img
                            key={`${cycle}-${n}`}
                            className={`mp-sun mp-sun-${sun.tone}`}
                            src="/menu/emblem.png"
                            alt=""
                            loading="lazy"
                            style={{ top: sun.top + cycle * SUN_CYCLE, left: sun.left, width: sun.size }}
                        />
                    )),
                )}
            </div>

            {/* The header scrolls away; only the category nav below is sticky.
                No shared wrapper: a sticky nav inside a wrapper that ends at the
                nav would unstick the moment the wrapper scrolls past. */}
            <header className="mp-header">
                <div className="mp-header-row">
                    <img
                        className="mp-logo-img"
                        src="/menu/header-logo-leather.png"
                        alt="Fusionista — Modern Peruvian Cuisine"
                        onClick={onLogoTap}
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
                {syncLine && (
                    <p className={`mp-sync-line${syncLine.offline ? ' mp-sync-offline' : ''}`} aria-live="polite">
                        {syncLine.text}
                    </p>
                )}
            </header>

            {categories.length > 0 && (
                <nav className="mp-catbar" aria-label="Categories">
                    {categories.map(cat => (
                        <button
                            key={cat.id}
                            aria-pressed={activeCategory === cat.id}
                            className={`mp-tab${activeCategory === cat.id ? ' mp-tab-active' : ''}`}
                            onClick={() => selectCategory(cat.id)}
                        >
                            {categoryName(cat)}
                        </button>
                    ))}
                </nav>
            )}

            {categories.length === 0 ? (
                <p className="mp-empty">{t.empty}</p>
            ) : (
                currentCategory && (
                    <main className="mp-main">
                        {/* key remounts the section per tab so the opacity fade replays */}
                        <section key={currentCategory.id} className="mp-section-fade">
                            {/* Gold rule, emblem, gold rule — then the name in
                                spaced caps, then the category's own subtitle. */}
                            <div className="mp-section-crest" aria-hidden="true">
                                <span className="mp-rule-gold" />
                                <img className="mp-crest-emblem" src="/menu/emblem.png" alt="" />
                                <span className="mp-rule-gold" />
                            </div>
                            <h2 className="mp-section-title">{categoryName(currentCategory)}</h2>
                            {sectionLead && <p className="mp-section-lead">{sectionLead}</p>}
                            {currentItems.length === 0 ? (
                                <p className="mp-comingsoon">{t.comingSoon}</p>
                            ) : (
                                <>
                                    {/* Favorites sit above the grid, not inside it:
                                        the count drives the whole treatment (one
                                        banner vs two tall frames), which a grid
                                        child spanning columns cannot express. */}
                                    {featured.length > 0 && (
                                        <>
                                            <div className={`mp-favs mp-favs-${featured.length}`}>
                                                {featured.map(renderFavorite)}
                                            </div>
                                            <Greca />
                                        </>
                                    )}
                                    {regularItems.length > 0 && (
                                        <div className="mp-grid">
                                            {regularItems.map(renderDish)}
                                        </div>
                                    )}
                                    <div className="mp-section-end">
                                        <img className="mp-end-emblem" src="/menu/emblem.png" alt="" aria-hidden="true" />
                                        <span className="mp-end-text">Buen provecho</span>
                                    </div>
                                </>
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

            {renderLightbox()}

            {standalone && staffOpen && (
                <StaffPanel sync={sync} onSyncNow={syncNow} onClose={() => setStaffOpen(false)} />
            )}
        </div>
    );
}
