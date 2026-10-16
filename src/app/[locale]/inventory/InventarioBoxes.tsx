'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getInventarioOverview } from '@/app/actions/inventory';
import { getConversionFactor } from '@/lib/conversion';
import { unitLabel } from '@/lib/purchaseUnits';

// Admin "Inventario" box view: one box per active RAW, its unprocessed stock
// first, then one block per active PROCESSED child. Read-only; tapping a box
// header opens the page's existing edit modal. Status uses the page's existing
// fixed rule (> 5 ok, > 0 low, else out). No backdrop-filter / transform /
// filter / perspective / will-change on anything here.

type Overview = Awaited<ReturnType<typeof getInventarioOverview>>['data'][number];
type Level = 'OK' | 'LOW' | 'OUT';

const level = (stock: number): Level => (stock > 5 ? 'OK' : stock > 0 ? 'LOW' : 'OUT');
const total = (inv: { frozenQty: number; thawingQty: number } | null) => (inv?.frozenQty ?? 0) + (inv?.thawingQty ?? 0);
const fmt = (n: number) => Number(n.toFixed(2)).toString();

const CHIP: Record<Level, { bg: string; fg: string }> = {
    OK: { bg: 'rgba(16,185,129,0.15)', fg: 'var(--success)' },
    LOW: { bg: 'rgba(245,158,11,0.18)', fg: 'var(--warning)' },
    OUT: { bg: 'rgba(239,68,68,0.15)', fg: 'var(--danger)' },
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

    const visible = useMemo(() => {
        const q = search.trim().toLowerCase();
        return items.filter(r =>
            (category === null || categoryKey(r) === category) &&
            (!q || r.name.toLowerCase().includes(q) || (r.nameEs ?? '').toLowerCase().includes(q) ||
                r.children.some(c => c.name.toLowerCase().includes(q) || (c.nameEs ?? '').toLowerCase().includes(q))))
            // Raws with children first, then by the name actually shown (nameEs in ES).
            .sort((a, b) => (a.children.length ? 0 : 1) - (b.children.length ? 0 : 1) || display(a).localeCompare(display(b), locale));
    }, [items, category, search, locale]);

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

    if (isLoading) {
        return <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>{t('loading')}</div>;
    }

    return (
        <div style={{ marginTop: '2rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <style>{`
                .inv-boxes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-flow: row dense; gap: 1rem; }
                .inv-box-full { grid-column: 1 / -1; }
                .inv-blocks { display: grid; gap: 0.75rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
                .inv-box-full .inv-blocks { grid-template-columns: repeat(4, minmax(0, 1fr)); }
                @media (max-width: 700px) {
                    .inv-boxes { grid-template-columns: minmax(0, 1fr); }
                    .inv-box-full .inv-blocks { grid-template-columns: repeat(2, minmax(0, 1fr)); }
                }
            `}</style>

            <div>
                <h2 style={{ fontSize: '1.75rem', fontWeight: 700, margin: 0 }}>{t('title')}</h2>
                <p style={{ color: 'var(--text-secondary)', margin: '0.25rem 0 0' }}>{t('count', { count: visible.length })}</p>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                {[[null, t('all')] as [string | null, string], ...pills].map(([key, label]) => {
                    const active = category === key;
                    return (
                        <button key={key ?? '__all__'} onClick={() => setCategory(key)}
                            style={{ minHeight: '44px', padding: '0.5rem 1rem', borderRadius: '999px', fontWeight: 500, cursor: 'pointer',
                                border: active ? 'none' : '1px solid var(--border)',
                                background: active ? 'var(--accent-primary)' : 'transparent',
                                color: active ? '#fff' : 'var(--text-secondary)' }}>
                            {label}
                        </button>
                    );
                })}
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('search')}
                    style={{ minHeight: '44px', padding: '0.5rem 0.75rem', borderRadius: '8px', border: '1px solid var(--border)',
                        background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '1rem', flex: '1 1 220px', maxWidth: '360px' }} />
            </div>

            {visible.length === 0 && <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>{t('noResults')}</div>}

            <div className="inv-boxes">
                {visible.map(r => {
                    const stock = total(r.inventory);
                    const chip = level(stock);
                    const children = [...r.children].sort((a, b) => Number(/^merma/i.test(a.name)) - Number(/^merma/i.test(b.name)));
                    const statusLabel = chip === 'OK' ? t('statusOk') : chip === 'LOW' ? t('statusLow') : t('statusOut');
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
                                    {statusLabel}
                                </span>
                            </button>

                            <div className="inv-blocks">
                                <Block title={t('unprocessed')} value={stock} unit={unitLabel(r.metric, locale)} info={rawInfo(r, stock)} t={t} />
                                {children.map(c => {
                                    const cStock = total(c.inventory);
                                    const isPortion = !!c.portionWeightG && unitLabel(c.metric) === unitLabel('Units');
                                    return (
                                        <Block key={c.id} title={display(c)} value={cStock}
                                            unit={isPortion ? t('portions') : unitLabel(c.metric, locale)}
                                            info={c.trackFreezerStatus ? t('frozenFridge', { frozen: fmt(c.inventory?.frozenQty ?? 0), fridge: fmt(c.inventory?.thawingQty ?? 0) }) : ''}
                                            t={t} />
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function Block({ title, value, unit, info, t }: {
    title: string; value: number; unit: string; info: string; t: ReturnType<typeof useTranslations>;
}) {
    const lv = level(value);
    return (
        <div style={{ padding: '0.75rem', borderRadius: '10px', border: '1px solid var(--border)', minWidth: 0,
            background: lv === 'LOW' ? 'rgba(245,158,11,0.18)' : 'var(--bg-secondary)' }}>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500, overflowWrap: 'anywhere' }}>{title}</div>
            <div style={{ fontSize: '1.6rem', fontWeight: 700, color: lv === 'OUT' ? 'var(--danger)' : 'var(--text-primary)' }}>
                {fmt(value)} <span style={{ fontSize: '0.9rem', fontWeight: 500, color: 'var(--text-secondary)' }}>{unit}</span>
            </div>
            {lv !== 'OK' && (
                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: lv === 'OUT' ? 'var(--danger)' : 'var(--warning)' }}>
                    {lv === 'OUT' ? t('out') : t('low')}
                </div>
            )}
            {info && <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{info}</div>}
        </div>
    );
}
