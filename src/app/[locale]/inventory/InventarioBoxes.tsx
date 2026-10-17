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
    onEdit: (rawId: string) => void;
}

export default function InventarioBoxes({ locale, reloadKey, onEdit }: Props) {
    const t = useTranslations('Inventario');
    const [items, setItems] = useState<Overview[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [category, setCategory] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [onlyOrder, setOnlyOrder] = useState(false);

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

    const pills = useMemo(() => {
        const seen = new Map<string, string>();
        for (const r of items) if (!seen.has(categoryKey(r))) seen.set(categoryKey(r), categoryLabel(r));
        return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1], locale));
    }, [items, locale]);

    const toOrderCount = useMemo(() => items.filter(r => level(total(r.inventory)) !== 'OK').length, [items]);

    const { groups, simples } = useMemo(() => {
        const q = search.trim().toLowerCase();
        const rank = { OUT: 0, LOW: 1, OK: 2 } as const;
        const shown = items.filter(r =>
            (category === null || categoryKey(r) === category) &&
            (!onlyOrder || level(total(r.inventory)) !== 'OK') &&
            (!q || r.name.toLowerCase().includes(q) || (r.nameEs ?? '').toLowerCase().includes(q) ||
                r.children.some(c => c.name.toLowerCase().includes(q) || (c.nameEs ?? '').toLowerCase().includes(q))));
        // Sorted by the name actually shown (nameEs in ES). Simple items: OUT, then LOW, then A–Z.
        const byName = (a: Overview, b: Overview) => display(a).localeCompare(display(b), locale);
        return {
            groups: shown.filter(r => r.children.length > 0).sort(byName),
            simples: shown.filter(r => r.children.length === 0)
                .sort((a, b) => rank[level(total(a.inventory))] - rank[level(total(b.inventory))] || byName(a, b)),
        };
    }, [items, category, onlyOrder, search, locale]);
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
        minHeight: '44px', padding: '0.5rem 1rem', borderRadius: '999px', fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
        border: active ? 'none' : '1px solid var(--border)',
        background: active ? 'var(--accent-primary)' : 'transparent',
        color: active ? '#fff' : 'var(--text-secondary)',
    });
    const sectionLabel: React.CSSProperties = { fontSize: '0.8rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-primary)' };

    return (
        <div style={{ marginTop: '2rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <style>{`
                .inv-k-raw { background: rgba(59,130,246,0.10); border: 1px solid rgba(59,130,246,0.45); }
                .inv-k-proc { background: rgba(139,92,246,0.10); border: 1px solid rgba(139,92,246,0.45); }
                .inv-k-merma { background: rgba(236,72,153,0.10); border: 1px solid rgba(236,72,153,0.45); }
                .dark .inv-k-raw { background: rgba(59,130,246,0.18); border-color: rgba(59,130,246,0.6); }
                .dark .inv-k-proc { background: rgba(139,92,246,0.18); border-color: rgba(139,92,246,0.6); }
                .dark .inv-k-merma { background: rgba(236,72,153,0.18); border-color: rgba(236,72,153,0.6); }
                .inv-filters { display: flex; align-items: center; gap: 0.5rem; }
                .inv-strip-wrap { position: relative; flex: 1 1 0; min-width: 0; }
                .inv-strip-wrap::after { content: ''; position: absolute; top: 0; right: 0; bottom: 0; width: 36px; pointer-events: none;
                    background: linear-gradient(to right, transparent, var(--bg-primary)); }
                .inv-strip { display: flex; gap: 0.5rem; overflow-x: auto; flex-wrap: nowrap; scrollbar-width: none; padding-right: 36px; }
                .inv-strip::-webkit-scrollbar { display: none; }
                .inv-boxes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-flow: row dense; gap: 1rem; }
                .inv-box-full { grid-column: 1 / -1; }
                .inv-blocks { display: flex; flex-wrap: wrap; gap: 0.75rem; }
                .inv-block { flex: 1 1 0; min-width: 170px; }
                .inv-simple { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0.75rem; }
                .inv-swatch { display: inline-block; width: 14px; height: 14px; border-radius: 4px; flex-shrink: 0; }
                @media (max-width: 900px) {
                    .inv-simple { grid-template-columns: repeat(2, minmax(0, 1fr)); }
                }
                @media (max-width: 700px) {
                    .inv-boxes { grid-template-columns: minmax(0, 1fr); }
                }
            `}</style>

            <div className="inv-filters">
                <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                    <button onClick={() => { setCategory(null); setOnlyOrder(false); }} style={pillStyle(category === null && !onlyOrder)}>{t('all')}</button>
                    <button onClick={() => setOnlyOrder(v => !v)} style={pillStyle(onlyOrder)}>{t('toOrder', { count: toOrderCount })}</button>
                </div>
                <div className="inv-strip-wrap">
                    <div className="inv-strip">
                        {pills.map(([key, label]) => (
                            <button key={key} onClick={() => setCategory(category === key ? null : key)} style={pillStyle(category === key)}>{label}</button>
                        ))}
                    </div>
                </div>
                <span style={{ flexShrink: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{t('count', { count: visibleCount })}</span>
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('search')}
                    style={{ minHeight: '44px', padding: '0.5rem 0.5rem', borderRadius: '8px', border: '1px solid var(--border)',
                        background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '1rem', flex: '0 1 280px', minWidth: '140px' }} />
            </div>

            {visibleCount === 0 && <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>{t('noResults')}</div>}

            {groups.length > 0 && (
                <section style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '1rem', flexWrap: 'wrap' }}>
                        <div>
                            <div style={sectionLabel}>{t('groups', { count: groups.length })}</div>
                            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('groupsSub')}</div>
                        </div>
                        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            {([['inv-k-raw', t('legendRaw')], ['inv-k-proc', t('legendProcessed')], ['inv-k-merma', t('legendTrim')]] as const).map(([cls, label]) => (
                                <span key={cls} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                                    <span className={`inv-swatch ${cls}`} />{label}
                                </span>
                            ))}
                        </div>
                    </div>

                    <div className="inv-boxes">
                        {groups.map(r => {
                            const stock = total(r.inventory);
                            const chip = level(stock);
                            const children = [...r.children].sort((a, b) => Number(/^merma/i.test(a.name)) - Number(/^merma/i.test(b.name)));
                            return (
                                <div key={r.id} className={`glass-panel${r.children.length >= 2 ? ' inv-box-full' : ''}`} style={{ padding: '1rem' }}>
                                    <button onClick={() => onEdit(r.id)} title={t('editHint', { name: display(r) })}
                                        style={{ width: '100%', minHeight: '44px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.75rem',
                                            background: 'transparent', border: 'none', padding: 0, marginBottom: '0.75rem', textAlign: 'left', color: 'var(--text-primary)', cursor: 'pointer' }}>
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
                                    </button>

                                    <div className="inv-blocks">
                                        <Block kind="RAW" tag={tagOf('RAW')} title={rawTitle(r)} value={stock} unit={unitLabel(r.metric, locale)} info={rawInfo(r, stock)} t={t} />
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
                    <div>
                        <div style={sectionLabel}>{t('simple', { count: simples.length })}</div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('simpleSub')}</div>
                    </div>
                    <div className="inv-simple">
                        {simples.map(r => {
                            const stock = total(r.inventory);
                            const lv = level(stock);
                            return (
                                <button key={r.id} onClick={() => onEdit(r.id)} title={t('editHint', { name: display(r) })} className="inv-k-raw"
                                    style={{ minHeight: '44px', padding: '0.75rem', borderRadius: '10px', minWidth: 0, textAlign: 'left',
                                        color: 'var(--text-primary)', cursor: 'pointer', fontFamily: 'inherit' }}>
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
                                </button>
                            );
                        })}
                    </div>
                </section>
            )}
        </div>
    );
}

function Block({ kind, tag, title, value, unit, info, t }: {
    kind: Kind; tag: string; title: string; value: number; unit: string; info: string; t: ReturnType<typeof useTranslations>;
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
        </div>
    );
}
