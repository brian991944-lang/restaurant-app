'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
    getStorageOverview, getStorageIngredientOptions, moveStorage, adjustStorage, addToStorage, moveSalonBodegaToFront,
    type StorageRow, type SalonBodegaRow, type StorageMovementRow, type StorageLocation, type MoveTarget,
} from '@/app/actions/storage';
import { unitLabel } from '@/lib/purchaseUnits';

// Almacén (admin). One command row, a three-place switcher, rows in purchase
// units with "Llevar" expanding inline, and the movements log beside them.
// Quantities shown here never reach the kitchen view; cooks get a yes/no.
// No backdrop-filter / transform / filter / perspective / will-change here.

type Place = 'HOME' | 'BASEMENT_KITCHEN' | 'BASEMENT_SALON';
type Overview = { rows: StorageRow[]; salon: SalonBodegaRow[]; movements: StorageMovementRow[] };

export default function AlmacenView({ locale }: { locale: 'es' | 'en' }) {
    const t = useTranslations('Almacen');
    const [data, setData] = useState<Overview | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [place, setPlace] = useState<Place>('HOME');
    const [search, setSearch] = useState('');
    const [open, setOpen] = useState<string | null>(null);          // row key with the Llevar panel open
    const [moveQty, setMoveQty] = useState(1);
    const [moveTo, setMoveTo] = useState<MoveTarget>('BASEMENT_KITCHEN');
    const [moveWeight, setMoveWeight] = useState('');                 // lb, only asked when the row has no weight and needs one
    const [adjusting, setAdjusting] = useState<{ row: StorageRow; qty: string; note: string } | null>(null);
    const [entry, setEntry] = useState<{ ingredientId: string; qty: string; unit: string; weight: string; location: StorageLocation } | null>(null);
    const [options, setOptions] = useState<{ id: string; name: string; nameEs: string | null; metric: string; isPacked: boolean; packUnit: string }[]>([]);
    const [busy, setBusy] = useState(false);
    const [flash, setFlash] = useState<string | null>(null);

    const load = async () => {
        const res = await getStorageOverview();
        if (res.success) { setData({ rows: res.rows, salon: res.salon, movements: res.movements }); setError(null); }
        else setError(res.error);
    };
    useEffect(() => { load(); }, []);

    const display = (r: { name: string; nameEs: string | null }) => (locale === 'es' && r.nameEs ? r.nameEs : r.name);
    const dateFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
    const fmtDate = (iso: string | null) => (iso ? t('lastEntry', { date: dateFmt.format(new Date(iso)) }) : t('noEntry'));
    const num = (n: number) => Number(n.toFixed(2)).toString();
    const rowKey = (r: StorageRow) => `${r.ingredientId}|${r.location}|${r.unit}`;

    const counts = useMemo(() => ({
        HOME: new Set(data?.rows.filter(r => r.location === 'HOME').map(r => r.ingredientId)).size,
        BASEMENT_KITCHEN: new Set(data?.rows.filter(r => r.location === 'BASEMENT_KITCHEN').map(r => r.ingredientId)).size,
        BASEMENT_SALON: data?.salon.filter(s => s.qtyBodega > 0).length ?? 0,
    }), [data]);
    const total = counts.HOME + counts.BASEMENT_KITCHEN + counts.BASEMENT_SALON;

    const q = search.trim().toLowerCase();
    const rows = (data?.rows ?? []).filter(r => r.location === place && (!q || display(r).toLowerCase().includes(q) || r.name.toLowerCase().includes(q)));
    const salonRows = (data?.salon ?? []).filter(s => !q || display(s).toLowerCase().includes(q) || s.name.toLowerCase().includes(q));

    const placeLabel = (p: string) => p === 'HOME' ? t('locHome') : p === 'BASEMENT_KITCHEN' ? t('locBasementKitchen') : t('locBasementSalon');
    const mvLabel = (prefix: 'mvFrom_' | 'mvTo_', v: string) => {
        const known = ['PURCHASE', 'MANUAL', 'HOME', 'BASEMENT_KITCHEN', 'BASEMENT_SALON', 'KITCHEN', 'SALON_FRONT', 'ADJUST', 'OPENED'];
        return known.includes(v) ? t(`${prefix}${v}` as any) : v;
    };

    const say = (msg: string) => { setFlash(msg); setTimeout(() => setFlash(null), 3500); };

    const doMove = async (r: StorageRow) => {
        if (busy) return;
        setBusy(true);
        const weight = Number(moveWeight);
        const res = await moveStorage({ ingredientId: r.ingredientId, from: r.location, to: moveTo, qty: moveQty, unit: r.unit, totalWeightLb: weight > 0 ? weight : null });
        setBusy(false);
        if (!res.success) { setError(res.error); return; }
        setOpen(null); setMoveQty(1); setMoveWeight('');
        if (res.credited != null) say(t('credited', { qty: num(res.credited), unit: unitLabel(r.metric, locale) }));
        load();
    };

    const doSalonMove = async (s: SalonBodegaRow) => {
        if (busy) return;
        setBusy(true);
        const res = await moveSalonBodegaToFront(s.ingredientId, moveQty);
        setBusy(false);
        if (!res.success) { setError(res.error); return; }
        setOpen(null); setMoveQty(1);
        load();
    };

    const doAdjust = async () => {
        if (!adjusting || busy) return;
        const qty = Number(adjusting.qty);
        if (!(qty >= 0)) return;
        setBusy(true);
        const res = await adjustStorage({ ingredientId: adjusting.row.ingredientId, location: adjusting.row.location, unit: adjusting.row.unit, qty, note: adjusting.note || null });
        setBusy(false);
        if (!res.success) { setError(res.error); return; }
        setAdjusting(null);
        load();
    };

    const openEntry = async () => {
        if (options.length === 0) {
            const res = await getStorageIngredientOptions();
            if (res.success) setOptions(res.list);
        }
        setEntry({ ingredientId: '', qty: '1', unit: '', weight: '', location: place === 'BASEMENT_SALON' ? 'BASEMENT_KITCHEN' : place });
    };
    const doEntry = async () => {
        if (!entry || busy) return;
        const qty = Number(entry.qty);
        if (!entry.ingredientId || !(qty > 0) || !entry.unit.trim()) return;
        setBusy(true);
        const res = await addToStorage({ ingredientId: entry.ingredientId, location: entry.location, qty, unit: entry.unit.trim(), totalWeightLb: entry.weight ? Number(entry.weight) : null });
        setBusy(false);
        if (!res.success) { setError(res.error); return; }
        setEntry(null);
        load();
    };

    // ── styles ──
    const seg = (active: boolean): React.CSSProperties => ({
        minHeight: '44px', padding: '0 1.1rem', borderRadius: '9px', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: '0.95rem',
        fontWeight: active ? 600 : 500, background: active ? 'var(--bg-primary)' : 'transparent', color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
        boxShadow: active ? '0 1px 2px rgba(0,0,0,0.12)' : 'none',
    });
    const ghost: React.CSSProperties = { minHeight: '40px', padding: '0 0.9rem', borderRadius: '10px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontFamily: 'inherit', fontSize: '0.9rem', fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' };
    const outline: React.CSSProperties = { ...ghost, border: '1px solid var(--accent-primary)', color: 'var(--accent-primary)', fontWeight: 600 };
    const primary: React.CSSProperties = { ...ghost, border: 'none', background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))', color: '#fff', fontWeight: 600 };
    const stepBtn = (on: boolean): React.CSSProperties => ({ width: 40, height: 40, borderRadius: '9px', border: on ? '1px solid var(--accent-primary)' : '1px solid var(--border)', background: on ? 'var(--accent-primary)' : 'transparent', color: on ? '#fff' : 'var(--text-primary)', fontFamily: 'inherit', fontSize: '1.2rem', cursor: 'pointer' });
    const input: React.CSSProperties = { minHeight: '44px', padding: '0 0.75rem', borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: '1rem' };
    const card: React.CSSProperties = { padding: '0.9rem 1.1rem', borderRadius: '14px', background: 'var(--bg-glass)', border: 'var(--glass-border)' };
    const modal: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' };
    const sheet: React.CSSProperties = { background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '14px', padding: '1.25rem', width: '100%', maxWidth: '460px', display: 'flex', flexDirection: 'column', gap: '0.75rem' };

    const movePanel = (onConfirm: () => void, withTarget: boolean, askWeight = false) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', paddingTop: '0.75rem', marginTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
            <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{t('take')}</span>
            <button aria-label="−" style={stepBtn(false)} onClick={() => setMoveQty(q => Math.max(1, q - 1))}>−</button>
            <span style={{ width: 32, textAlign: 'center', fontSize: '1.15rem', fontWeight: 700 }}>{moveQty}</span>
            <button aria-label="+" style={stepBtn(true)} onClick={() => setMoveQty(q => q + 1)}>+</button>
            {withTarget && (<>
                <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{t('to')}</span>
                <div style={{ display: 'flex', gap: 2, padding: 3, borderRadius: '10px', background: 'rgba(127,127,127,0.12)' }}>
                    {place === 'HOME' && <button style={seg(moveTo === 'BASEMENT_KITCHEN')} onClick={() => setMoveTo('BASEMENT_KITCHEN')}>{t('destBasement')}</button>}
                    <button style={seg(moveTo === 'KITCHEN')} onClick={() => setMoveTo('KITCHEN')}>{t('destKitchen')}</button>
                </div>
            </>)}
            {askWeight && moveTo === 'KITCHEN' && (
                <input type="number" inputMode="decimal" min="0" step="any" value={moveWeight} onChange={e => setMoveWeight(e.target.value)}
                    placeholder={t('moveWeight')} aria-label={t('moveWeight')} style={{ ...input, width: 150 }} />
            )}
            <div style={{ flexGrow: 1 }} />
            <button style={primary} onClick={onConfirm} disabled={busy}>{t('confirm')}</button>
        </div>
    );

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem', padding: '1.5rem', maxWidth: '1400px', margin: '0 auto' }}>
            <style>{`
                .alm-row-actions { display: flex; gap: 0.5rem; justify-content: flex-end; flex-shrink: 0; }
                .alm-main { display: flex; gap: 1rem; align-items: flex-start; }
                .alm-log { width: 300px; flex-shrink: 0; }
                @media (max-width: 900px) { .alm-main { flex-direction: column; } .alm-log { width: 100%; } }
            `}</style>

            {/* command row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.9rem', minWidth: 0 }}>
                    <h1 style={{ fontSize: '2.1rem', fontWeight: 700, margin: 0 }}>{t('title')}</h1>
                    <span style={{ fontSize: '0.95rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{t('subtitle', { count: total })}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('search')} style={{ ...input, width: 240 }} />
                    <button style={primary} onClick={openEntry}>{t('addEntry')}</button>
                </div>
            </div>

            {/* place switcher */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: 2, padding: 3, borderRadius: '12px', background: 'rgba(127,127,127,0.12)' }}>
                    {(['HOME', 'BASEMENT_KITCHEN', 'BASEMENT_SALON'] as Place[]).map(p => (
                        <button key={p} style={seg(place === p)} onClick={() => { setPlace(p); setOpen(null); setMoveTo(p === 'HOME' ? 'BASEMENT_KITCHEN' : 'KITCHEN'); }}>
                            {placeLabel(p)} <span style={{ opacity: 0.7, fontWeight: 500 }}>· {counts[p]}</span>
                        </button>
                    ))}
                </div>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{place === 'BASEMENT_SALON' ? t('hintSalon') : t('hint')}</span>
            </div>

            {error && <div style={{ padding: '0.75rem 1rem', borderRadius: '10px', background: 'rgba(239,68,68,0.12)', color: 'var(--danger)', fontWeight: 600 }}>{error}</div>}
            {flash && <div style={{ padding: '0.75rem 1rem', borderRadius: '10px', background: 'rgba(16,185,129,0.14)', color: 'var(--success)', fontWeight: 600 }}>{flash}</div>}

            {!data && !error && <div style={{ padding: '2rem', color: 'var(--text-secondary)' }}>{t('loading')}</div>}

            {data && (
                <div className="alm-main">
                    <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {place !== 'BASEMENT_SALON' && rows.length === 0 && <div style={{ ...card, color: 'var(--text-secondary)' }}>{t('empty')}</div>}
                        {place !== 'BASEMENT_SALON' && rows.map(r => {
                            const k = rowKey(r);
                            const isOpen = open === k;
                            return (
                                <div key={k} style={{ ...card, ...(isOpen ? { border: '1px solid var(--accent-primary)' } : {}) }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                        <div style={{ flexGrow: 1, minWidth: 0 }}>
                                            <div style={{ fontSize: '1.05rem', fontWeight: 600 }}>{display(r)}</div>
                                            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{(locale === 'es' && r.categoryEs) || r.category} · {fmtDate(r.lastEntryAt)}</div>
                                        </div>
                                        <div style={{ width: 150, textAlign: 'right', flexShrink: 0 }}>
                                            <div style={{ fontSize: '1.5rem', fontWeight: 700, lineHeight: 1 }}>{num(r.qty)} <span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-secondary)' }}>{r.unit}</span></div>
                                            {r.totalWeightLb != null && r.totalWeightLb > 0 && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>≈ {num(r.totalWeightLb)} lb</div>}
                                        </div>
                                        <div className="alm-row-actions">
                                            {isOpen
                                                ? <button style={ghost} onClick={() => setOpen(null)}>{t('cancel')}</button>
                                                : <button style={outline} onClick={() => { setOpen(k); setMoveQty(1); setMoveWeight(''); setMoveTo(r.location === 'HOME' ? 'BASEMENT_KITCHEN' : 'KITCHEN'); }}>{t('move')}</button>}
                                            <button style={ghost} onClick={() => setAdjusting({ row: r, qty: String(r.qty), note: '' })}>{t('adjust')}</button>
                                        </div>
                                    </div>
                                    {isOpen && movePanel(() => doMove(r), true, r.needsWeight)}
                                </div>
                            );
                        })}

                        {place === 'BASEMENT_SALON' && salonRows.length === 0 && <div style={{ ...card, color: 'var(--text-secondary)' }}>{t('empty')}</div>}
                        {place === 'BASEMENT_SALON' && salonRows.map(s => {
                            const k = `salon|${s.ingredientId}`;
                            const isOpen = open === k;
                            return (
                                <div key={k} style={{ ...card, ...(isOpen ? { border: '1px solid var(--accent-primary)' } : {}) }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                        <div style={{ flexGrow: 1, minWidth: 0 }}>
                                            <div style={{ fontSize: '1.05rem', fontWeight: 600 }}>{display(s)}</div>
                                            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{s.salonGroup} · {fmtDate(s.lastEntryAt)}</div>
                                        </div>
                                        <div style={{ width: 150, textAlign: 'right', flexShrink: 0 }}>
                                            <div style={{ fontSize: '1.25rem', fontWeight: 700, lineHeight: 1 }}>{s.qtyFront} <span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-secondary)' }}>{t('inFront')}</span></div>
                                        </div>
                                        <div style={{ width: 150, textAlign: 'right', flexShrink: 0 }}>
                                            <div style={{ fontSize: '1.5rem', fontWeight: 700, lineHeight: 1, color: s.qtyBodega === 0 ? 'var(--danger)' : 'var(--text-primary)' }}>{s.qtyBodega} <span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-secondary)' }}>{unitLabel('Units', locale)}</span></div>
                                        </div>
                                        <div className="alm-row-actions">
                                            {isOpen
                                                ? <button style={ghost} onClick={() => setOpen(null)}>{t('cancel')}</button>
                                                : <button style={outline} disabled={s.qtyBodega === 0} onClick={() => { setOpen(k); setMoveQty(1); }}>{t('moveToFront')}</button>}
                                        </div>
                                    </div>
                                    {isOpen && movePanel(() => doSalonMove(s), false)}
                                </div>
                            );
                        })}
                    </div>

                    <aside className="alm-log" style={card}>
                        <div style={{ fontSize: '0.8rem', fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-secondary)', marginBottom: '0.4rem' }}>{t('movements').toUpperCase()}</div>
                        {data.movements.length === 0 && <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>—</div>}
                        {data.movements.slice(0, 12).map(m => (
                            <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.6rem', padding: '0.5rem 0', borderBottom: '1px solid var(--border)', fontSize: '0.82rem' }}>
                                <div style={{ minWidth: 0 }}>
                                    <div style={{ fontWeight: 600 }}>{mvLabel('mvFrom_', m.fromLocation)} → {mvLabel('mvTo_', m.toLocation)}</div>
                                    <div style={{ color: 'var(--text-secondary)' }}>{display(m)} · {num(m.qty)} {m.unit}{m.byName ? ` · ${m.byName}` : ''}</div>
                                </div>
                                <div style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{dateFmt.format(new Date(m.createdAt))}</div>
                            </div>
                        ))}
                    </aside>
                </div>
            )}

            {adjusting && (
                <div style={modal} onClick={() => setAdjusting(null)}>
                    <div style={sheet} onClick={e => e.stopPropagation()}>
                        <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{display(adjusting.row)}</div>
                        <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{t('adjustTitle', { place: placeLabel(adjusting.row.location) })}</div>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            <input type="number" inputMode="decimal" min={0} step="any" value={adjusting.qty} onChange={e => setAdjusting({ ...adjusting, qty: e.target.value })} style={{ ...input, width: 140, fontSize: '1.3rem', fontWeight: 700 }} />
                            <span style={{ color: 'var(--text-secondary)' }}>{adjusting.row.unit}</span>
                        </div>
                        <input value={adjusting.note} onChange={e => setAdjusting({ ...adjusting, note: e.target.value })} placeholder={t('adjustNote')} style={input} />
                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                            <button style={ghost} onClick={() => setAdjusting(null)}>{t('cancel')}</button>
                            <button style={primary} onClick={doAdjust} disabled={busy}>{t('save')}</button>
                        </div>
                    </div>
                </div>
            )}

            {entry && (
                <div style={modal} onClick={() => setEntry(null)}>
                    <div style={sheet} onClick={e => e.stopPropagation()}>
                        <div style={{ fontSize: '1.1rem', fontWeight: 700 }}>{t('entryTitle')}</div>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('entryItem')}
                            <select value={entry.ingredientId} onChange={e => {
                                const o = options.find(x => x.id === e.target.value);
                                setEntry({ ...entry, ingredientId: e.target.value, unit: entry.unit || (o ? (o.isPacked ? 'paq.' : unitLabel(o.metric, locale)) : '') });
                            }} style={input}>
                                <option value="">{t('entryPick')}</option>
                                {options.map(o => <option key={o.id} value={o.id}>{locale === 'es' && o.nameEs ? o.nameEs : o.name}</option>)}
                            </select>
                        </label>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('entryQty')}
                                <input type="number" inputMode="decimal" min={0} step="any" value={entry.qty} onChange={e => setEntry({ ...entry, qty: e.target.value })} style={input} />
                            </label>
                            <label style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('entryUnit')}
                                <input value={entry.unit} onChange={e => setEntry({ ...entry, unit: e.target.value })} placeholder="frascos, cajas, bolas, lb" style={input} />
                            </label>
                        </div>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('entryWeight')}
                            <input type="number" inputMode="decimal" min={0} step="any" value={entry.weight} onChange={e => setEntry({ ...entry, weight: e.target.value })} style={input} />
                        </label>
                        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('entryWhere')}
                            <div style={{ display: 'flex', gap: 2, padding: 3, borderRadius: '10px', background: 'rgba(127,127,127,0.12)', alignSelf: 'flex-start' }}>
                                <button type="button" style={seg(entry.location === 'HOME')} onClick={() => setEntry({ ...entry, location: 'HOME' })}>{t('locHome')}</button>
                                <button type="button" style={seg(entry.location === 'BASEMENT_KITCHEN')} onClick={() => setEntry({ ...entry, location: 'BASEMENT_KITCHEN' })}>{t('locBasementKitchen')}</button>
                            </div>
                        </label>
                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                            <button style={ghost} onClick={() => setEntry(null)}>{t('cancel')}</button>
                            <button style={primary} onClick={doEntry} disabled={busy}>{t('save')}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
