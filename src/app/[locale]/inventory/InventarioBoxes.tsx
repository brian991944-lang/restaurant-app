'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getInventarioOverview } from '@/app/actions/inventory';
import { getConversionFactor } from '@/lib/conversion';
import { unitLabel } from '@/lib/purchaseUnits';

// Admin "Inventario" box view. Raws with active PROCESSED children are GRUPOS
// (one box: the raw block + one block per child, color-coded by type); raws
// without children are compact SIMPLE cards. Read-only; tapping a box header or
// card opens the page's existing edit modal. Status uses the page's existing
// fixed rule (> 5 ok, > 0 low, else out). No backdrop-filter / transform /
// filter / perspective / will-change on anything here.

type Overview = Awaited<ReturnType<typeof getInventarioOverview>>['data'][number];
type Level = 'OK' | 'LOW' | 'OUT';
type Kind = 'RAW' | 'PORTION' | 'BASE' | 'MERMA';

const level = (stock: number): Level => (stock > 5 ? 'OK' : stock > 0 ? 'LOW' : 'OUT');
const total = (inv: { frozenQty: number; thawingQty: number } | null) => (inv?.frozenQty ?? 0) + (inv?.thawingQty ?? 0);
const fmt = (n: number) => Number(n.toFixed(2)).toString();

const CHIP: Record<Level, { bg: string; fg: string }> = {
    OK: { bg: 'rgba(16,185,129,0.15)', fg: 'var(--success)' },
    LOW: { bg: 'rgba(245,158,11,0.18)', fg: 'var(--warning)' },
    OUT: { bg: 'rgba(239,68,68,0.15)', fg: 'var(--danger)' },
};
const LEVEL_COLOR: Record<Level, string> = { OK: 'var(--text-primary)', LOW: 'var(--warning)', OUT: 'var(--danger)' };

// Block class + tag background per type (colors live in the <style> below, per theme).
const KIND_CLASS: Record<Kind, string> = { RAW: 'inv-k-raw', PORTION: 'inv-k-proc', BASE: 'inv-k-proc', MERMA: 'inv-k-merma' };
const KIND_TAG_BG: Record<Kind, string> = {
    RAW: 'var(--accent-primary)', PORTION: 'var(--accent-secondary)', BASE: 'var(--accent-secondary)', MERMA: 'var(--merma)',
};

interface Props {
    locale: 'es' | 'en';
    /** Changes whenever the page reloads its data (e.g. after an edit), so the boxes refetch. */
    reloadKey: unknown;
    /** Omit for read-only viewers: headers and simple cards render as plain, non-clickable divs. */
    onEdit?: (rawId: string) => void;
    /** Search text from the page's command row. */
    search: string;
    /** Reports the group / simple totals once the data loads (used in the page subtitle). */
    onCounts?: (counts: { groups: number; simples: number }) => void;
}

// Short pill labels, keyed by the Category's stored English name. Several names can share a pill.
const SHORT_CATEGORY: Record<string, string> = {
    'Meat & Poultry': 'catMeat',
    'Seafood': 'catSeafood',
    'Dairy & Eggs': 'catDairy',
    'Produce': 'catProduce',
    'Pantry & Dry Goods': 'catPantry',
    'Spices, Sauces & Condiments': 'catSpices',
    'Productos Peruanos': 'catPeruvian',
    'Bebidas Salón': 'catDrinks',
    'Sodas y Bebidas': 'catDrinks',
    'Cleaning Supplies': 'catCleaning',
    'Papel y Contenedores': 'catPaper',
    'Kitchen Equipment': 'catEquipment',
    '': 'catOther',
};
const PILL_ORDER = [...new Set(Object.values(SHORT_CATEGORY))];

export default function InventarioBoxes({ locale, reloadKey, onEdit, search, onCounts }: Props) {
    const t = useTranslations('Inventario');
    const [items, setItems] = useState<Overview[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [category, setCategory] = useState<string | null>(null);

    useEffect(() => {
        let alive = true;
        getInventarioOverview().then(res => {
            if (!alive) return;
            if (res.success) setItems(res.data);
            setIsLoading(false);
        });
        return () => { alive = false; };
    }, [reloadKey]);

    const display = (o: { name: string; nameEs: string | null }) => (locale === 'es' && o.nameEs ? o.nameEs : o.name);
    const categoryKey = (r: Overview) => r.category?.name?.trim() || '';
    const categoryLabel = (r: Overview) => {
        if (!categoryKey(r)) return t('uncategorized');
        return locale === 'es' && r.category?.nameEs ? r.category.nameEs : r.category!.name;
    };

    // Pill id: the short catalog key, or the stored name for categories without one.
    const pillKey = (r: Overview) => SHORT_CATEGORY[categoryKey(r)] ?? `name:${categoryKey(r)}`;

    useEffect(() => {
        if (!isLoading) onCounts?.({ groups: items.filter(r => r.children.length > 0).length, simples: items.filter(r => r.children.length === 0).length });
    }, [items, isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

    const searched = useMemo(() => {
        const q = search.trim().toLowerCase();
        return !q ? items : items.filter(r => r.name.toLowerCase().includes(q) || (r.nameEs ?? '').toLowerCase().includes(q) ||
            r.children.some(c => c.name.toLowerCase().includes(q) || (c.nameEs ?? '').toLowerCase().includes(q)));
    }, [items, search]);

    // Only categories with at least one item in the current search result.
    const pills = useMemo(() => {
        const seen = new Map<string, string>();
        for (const r of searched) {
            const key = pillKey(r);
            if (!seen.has(key)) seen.set(key, key.startsWith('name:') ? categoryLabel(r) : t(key));
        }
        const pos = (k: string) => { const i = PILL_ORDER.indexOf(k); return i === -1 ? PILL_ORDER.length - 1 : i; };
        return [...seen.entries()].sort((a, b) => pos(a[0]) - pos(b[0]) || a[1].localeCompare(b[1], locale));
    }, [searched, locale]); // eslint-disable-line react-hooks/exhaustive-deps
    const activeCategory = category !== null && pills.some(([k]) => k === category) ? category : null;

    const { groups, simples } = useMemo(() => {
        const rank = { OUT: 0, LOW: 1, OK: 2 } as const;
        const shown = searched.filter(r => activeCategory === null || pillKey(r) === activeCategory);
        // Sorted by the name actually shown (nameEs in ES). Simple items: OUT, then LOW, then A–Z.
        const byName = (a: Overview, b: Overview) => display(a).localeCompare(display(b), locale);
        return {
            groups: shown.filter(r => r.children.length > 0).sort(byName),
            simples: shown.filter(r => r.children.length === 0)
                .sort((a, b) => rank[level(total(a.inventory))] - rank[level(total(b.inventory))] || byName(a, b)),
        };
    }, [searched, activeCategory, locale]); // eslint-disable-line react-hooks/exhaustive-deps
    const visibleCount = groups.length + simples.length;

    const dateFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });

    // Sub-line under the raw stock: packs, "≈ 3 bolas", or the last purchase date.
    const rawInfo = (r: Overview, stock: number): string => {
        if (r.isPacked) {
            const factor = unitLabel(r.packUnit) === unitLabel(r.metric) ? 1 : getConversionFactor(r.packUnit, r.metric);
            const perPack = factor ? r.unitsPerPack * factor : 0;
            if (perPack > 0 && stock > 0) return t('approxPacks', { count: Math.floor(stock / perPack) });
        } else if (r.lastPurchase && r.avgLbPerUnit && unitLabel(r.lastPurchase.unit) !== unitLabel(r.metric)) {
            const toLb = unitLabel(r.metric) === 'lb' ? 1 : getConversionFactor(r.metric, 'lb');
            if (toLb && stock > 0) return t('approxUnits', { count: Math.round((stock * toLb) / r.avgLbPerUnit), unit: r.lastPurchase.unit });
        }
        return r.lastPurchase ? t('lastPurchase', { date: dateFmt.format(new Date(r.lastPurchase.purchasedAt)) }) : '';
    };

    const rawTitle = (r: Overview) => {
        const cat = categoryKey(r);
        return cat === 'Meat & Poultry' ? t('toClean') : cat === 'Seafood' ? t('toPortion') : t('onHand');
    };
    const kindOf = (c: Overview['children'][number]): Kind =>
        /^merma/i.test(c.name) ? 'MERMA' : unitLabel(c.metric) === unitLabel('Units') ? 'PORTION' : 'BASE';
    const tagOf = (k: Kind) => (k === 'RAW' ? t('tagRaw') : k === 'PORTION' ? t('tagPortions') : k === 'BASE' ? t('tagBase') : t('tagTrim'));
    const statusLabel = (lv: Level) => (lv === 'OK' ? t('statusOk') : lv === 'LOW' ? t('statusLow') : t('statusOut'));

    if (isLoading) {
        return <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>{t('loading')}</div>;
    }

    const pillStyle = (active: boolean): React.CSSProperties => ({
        height: '40px', padding: '0 1rem', borderRadius: '999px', fontSize: '15px', fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap',
        border: active ? '1px solid var(--accent-primary)' : '1px solid var(--border)',
        background: active ? 'var(--accent-primary)' : 'var(--bg-primary)',
        color: active ? '#fff' : 'var(--text-primary)',
    });
    const sectionLabel: React.CSSProperties = { fontSize: '13px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-secondary)' };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <style>{`
                .inv-k-raw { background: rgba(59,130,246,0.10); border: 1px solid rgba(59,130,246,0.45); }
                .inv-k-proc { background: rgba(139,92,246,0.10); border: 1px solid rgba(139,92,246,0.45); }
                .inv-k-merma { background: rgba(236,72,153,0.10); border: 1px solid rgba(236,72,153,0.45); }
                .dark .inv-k-raw { background: rgba(59,130,246,0.18); border-color: rgba(59,130,246,0.6); }
                .dark .inv-k-proc { background: rgba(139,92,246,0.18); border-color: rgba(139,92,246,0.6); }
                .dark .inv-k-merma { background: rgba(236,72,153,0.18); border-color: rgba(236,72,153,0.6); }
                .inv-pills { display: flex; flex-wrap: wrap; gap: 8px; }
                .inv-boxes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-flow: row dense; gap: 1rem; }
                .inv-box-full { grid-column: 1 / -1; }
                .inv-blocks { display: flex; flex-wrap: wrap; gap: 0.75rem; }
                .inv-block { flex: 1 1 0; min-width: 170px; }
                .inv-simple { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.75rem; }
                @media (max-width: 900px) {
                    .inv-simple { grid-template-columns: repeat(2, minmax(0, 1fr)); }
                }
                @media (max-width: 700px) {
                    .inv-boxes { grid-template-columns: minmax(0, 1fr); }
                }
            `}</style>

            <div className="inv-pills">
                <button onClick={() => setCategory(null)} style={pillStyle(activeCategory === null)}>{t('all')}</button>
                {pills.map(([key, label]) => (
                    <button key={key} onClick={() => setCategory(activeCategory === key ? null : key)} style={pillStyle(activeCategory === key)}>{label}</button>
                ))}
            </div>

            {visibleCount === 0 && <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>{t('noResults')}</div>}

            {groups.length > 0 && (
                <section style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <div style={sectionLabel}>{t('groups', { count: groups.length })}</div>

                    <div className="inv-boxes">
                        {groups.map(r => {
                            const stock = total(r.inventory);
                            const chip = level(stock);
                            const children = [...r.children].sort((a, b) => Number(/^merma/i.test(a.name)) - Number(/^merma/i.test(b.name)));
                            return (
                                <div key={r.id} className={`glass-panel${r.children.length >= 2 ? ' inv-box-full' : ''}`} style={{ padding: '1rem' }}>
                                    <Clickable onEdit={onEdit} id={r.id} title={t('editHint', { name: display(r) })}
                                        style={{ width: '100%', minHeight: '44px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem',
                                            background: 'transparent', border: 'none', padding: 0, marginBottom: '0.75rem', textAlign: 'left', color: 'var(--text-primary)' }}>
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{display(r)}</div>
                                            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                                {r.provider?.name ?? '—'} · {categoryLabel(r)}
                                            </div>
                                        </div>
                                        <span style={{ flexShrink: 0, padding: '0.3rem 0.75rem', borderRadius: '999px', fontWeight: 600, fontSize: '0.85rem',
                                            background: CHIP[chip].bg, color: CHIP[chip].fg }}>
                                            {statusLabel(chip)}
                                        </span>
                                    </Clickable>

                                    <div className="inv-blocks">
                                        <Block kind="RAW" tag={tagOf('RAW')} title={rawTitle(r)} value={stock} unit={unitLabel(r.metric, locale)} info={rawInfo(r, stock)} t={t}
                                            footer={<SpareLine spare={r.spare} t={t} />} />
                                        {children.map(c => {
                                            const kind = kindOf(c);
                                            return (
                                                <Block key={c.id} kind={kind} tag={tagOf(kind)} title={display(c)} value={total(c.inventory)}
                                                    unit={kind === 'PORTION' ? t('portions') : unitLabel(c.metric, locale)}
                                                    info={c.trackFreezerStatus ? t('frozenFridge', { frozen: fmt(c.inventory?.frozenQty ?? 0), fridge: fmt(c.inventory?.thawingQty ?? 0) }) : ''}
                                                    t={t} />
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </section>
            )}

            {simples.length > 0 && (
                <section style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <div style={sectionLabel}>{t('simple', { count: simples.length })}</div>
                    <div className="inv-simple">
                        {simples.map(r => {
                            const stock = total(r.inventory);
                            const lv = level(stock);
                            return (
                                <Clickable key={r.id} onEdit={onEdit} id={r.id} title={t('editHint', { name: display(r) })} className="inv-k-raw"
                                    style={{ minHeight: '44px', padding: '0.75rem', borderRadius: '10px', minWidth: 0, textAlign: 'left',
                                        color: 'var(--text-primary)', fontFamily: 'inherit' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                                        <span style={{ fontSize: '0.95rem', fontWeight: 600, overflowWrap: 'anywhere' }}>{display(r)}</span>
                                        <span style={{ flexShrink: 0, padding: '0.15rem 0.55rem', borderRadius: '999px', fontWeight: 600, fontSize: '0.75rem',
                                            background: CHIP[lv].bg, color: CHIP[lv].fg }}>{statusLabel(lv)}</span>
                                    </div>
                                    <div style={{ fontSize: '1.6rem', fontWeight: 700, color: LEVEL_COLOR[lv] }}>
                                        {fmt(stock)} <span style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--text-secondary)' }}>{unitLabel(r.metric, locale)}</span>
                                    </div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>
                                        {r.provider?.name ?? '—'}{r.isPacked && rawInfo(r, stock) ? ` · ${rawInfo(r, stock)}` : ''}
                                    </div>
                                    <SpareLine spare={r.spare} t={t} />
                                </Clickable>
                            );
                        })}
                    </div>
                </section>
            )}
        </div>
    );
}

// A button that opens the edit modal for admins; a plain div (no cursor, no hint) when onEdit is absent.
function Clickable({ onEdit, id, title, className, style, children }: {
    onEdit?: (rawId: string) => void; id: string; title: string; className?: string; style: React.CSSProperties; children: React.ReactNode;
}) {
    if (!onEdit) return <div className={className} style={style}>{children}</div>;
    return <button onClick={() => onEdit(id)} title={title} className={className} style={{ ...style, cursor: 'pointer' }}>{children}</button>;
}

// The storage signal a cook sees: where a sealed spare exists, never how many.
// Green = basement (go get it), blue = Brian's house (ask him), amber = none.
function SpareLine({ spare, t }: { spare: 'BASEMENT' | 'HOME' | 'NONE'; t: ReturnType<typeof useTranslations> }) {
    const dot = spare === 'BASEMENT' ? 'var(--success)' : spare === 'HOME' ? 'var(--accent-primary)' : 'var(--warning)';
    const label = spare === 'BASEMENT' ? t('spareBasement') : spare === 'HOME' ? t('spareHome') : t('spareNone');
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', marginTop: '0.25rem',
            color: spare === 'NONE' ? 'var(--warning)' : 'var(--text-secondary)', fontWeight: spare === 'NONE' ? 600 : 400 }}>
            <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: dot, flexShrink: 0 }} />
            {label}
        </div>
    );
}

function Block({ kind, tag, title, value, unit, info, t, footer }: {
    kind: Kind; tag: string; title: string; value: number; unit: string; info: string; t: ReturnType<typeof useTranslations>; footer?: React.ReactNode;
}) {
    const lv = level(value);
    return (
        <div className={`inv-block ${KIND_CLASS[kind]}`} style={{ padding: '0.75rem', borderRadius: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500, overflowWrap: 'break-word', minWidth: 0 }}>{title}</div>
                <span style={{ flexShrink: 0, fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', padding: '2px 7px', borderRadius: '999px',
                    background: KIND_TAG_BG[kind], color: '#fff' }}>{tag}</span>
            </div>
            <div style={{ fontSize: '1.6rem', fontWeight: 700, color: LEVEL_COLOR[lv] }}>
                {fmt(value)} <span style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--text-secondary)' }}>{unit}</span>
            </div>
            {lv !== 'OK' && (
                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: LEVEL_COLOR[lv] }}>
                    {lv === 'OUT' ? t('out') : t('low')}
                </div>
            )}
            {info && <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{info}</div>}
            {footer}
        </div>
    );
}
