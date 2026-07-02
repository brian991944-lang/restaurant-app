'use client';

import { useEffect, useRef, useState } from 'react';

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

const UI_TEXT: Record<Lang, { title: string; subtitle: string; featured: string; empty: string }> = {
    en: {
        title: 'Fusionista',
        subtitle: 'Peruvian Kitchen · Menu',
        featured: 'Featured',
        empty: 'Menu coming soon.',
    },
    es: {
        title: 'Fusionista',
        subtitle: 'Cocina Peruana · Menú',
        featured: 'Destacado',
        empty: 'Menú disponible próximamente.',
    },
};

export default function MenuClient({
    categories,
    items,
}: {
    categories: MenuCategoryData[];
    items: MenuItemData[];
}) {
    const [lang, setLang] = useState<Lang>('es');
    const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
    const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
    const t = UI_TEXT[lang];

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

    return (
        <div className="mp-page">
            <header className="mp-header">
                <div>
                    <h1 className="mp-title">{t.title}</h1>
                    <p className="mp-subtitle">{t.subtitle}</p>
                </div>
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
                                    className={`mp-pill${activeCategoryId === cat.id ? ' mp-pill-active' : ''}`}
                                    onClick={() => scrollToCategory(cat.id)}
                                >
                                    {categoryName(cat)}
                                </button>
                            ))}
                        </div>
                    </nav>

                    <main className="mp-main">
                        {visibleCategories.map(cat => (
                            <section
                                key={cat.id}
                                className="mp-section"
                                data-category-id={cat.id}
                                ref={el => { sectionRefs.current[cat.id] = el; }}
                            >
                                <h2 className="mp-section-title">{categoryName(cat)}</h2>
                                <div className="mp-grid">
                                    {(itemsByCategory.get(cat.id) || []).map(item => (
                                        <article key={item.id} className="mp-card">
                                            <div className="mp-media">
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
                                                {item.isFeatured && (
                                                    <span className="mp-badge">{t.featured}</span>
                                                )}
                                            </div>
                                            <div className="mp-card-body">
                                                <div className="mp-card-row">
                                                    <h3 className="mp-item-name">{itemName(item)}</h3>
                                                    <span className="mp-price">${item.salePrice.toFixed(2)}</span>
                                                </div>
                                                {itemDescription(item) && (
                                                    <p className="mp-item-desc">{itemDescription(item)}</p>
                                                )}
                                            </div>
                                        </article>
                                    ))}
                                </div>
                            </section>
                        ))}
                    </main>
                </>
            )}
        </div>
    );
}
