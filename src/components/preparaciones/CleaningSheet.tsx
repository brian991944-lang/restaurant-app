'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getCleaningContext, completeCleaningSession, type CleaningContext } from '@/app/actions/cleaning';
import { computeCleaning, type CleaningFlag } from '@/lib/cleaningMath';

// Hoja de limpieza (cook). One sheet for every task under a raw protein:
// ① piezas + peso crudo (lb) ② merma (lb) ③ porciones por producto, with the
// yield and the "cuadra" check recomputed on every keystroke (same math the
// server saves). Plain fixed overlay, no backdrop-filter / transform.

interface Props {
    rawId: string;
    locale: 'es' | 'en';
    /** Preselect the cook(s) the page already knows, when any. */
    defaultCookIds?: string[];
    onClose: () => void;
    onDone: () => void;
}

const fmt = (n: number, d = 1) => Number(n.toFixed(d)).toString();

export default function CleaningSheet({ rawId, locale, defaultCookIds = [], onClose, onDone }: Props) {
    const t = useTranslations('Limpieza');
    const [ctx, setCtx] = useState<CleaningContext | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [units, setUnits] = useState<number>(0);
    const [rawWeight, setRawWeight] = useState('');
    const [waste, setWaste] = useState('');
    const [qty, setQty] = useState<Record<string, number>>({});
    const [cooks, setCooks] = useState<string[]>(defaultCookIds);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        let alive = true;
        getCleaningContext(rawId).then(res => {
            if (!alive) return;
            if (!res.success) { setError(res.error); return; }
            setCtx(res.context);
            // Start from the last purchase's piece count when it was bought by the piece.
            const lp = res.context.lastPurchase;
            if (lp && lp.unit && !/^lb/i.test(lp.unit.trim()) && lp.qty > 0 && lp.qty < 50) setUnits(Math.round(lp.qty));
            setQty(Object.fromEntries(res.context.products.map(p => [p.id, 0])));
        });
        return () => { alive = false; };
    }, [rawId]);

    const display = (o: { name: string; nameEs: string | null }) => (locale === 'es' && o.nameEs ? o.nameEs : o.name);
    const rawLb = parseFloat(rawWeight) || 0;
    const wasteLb = parseFloat(waste) || 0;

    const math = useMemo(() => ctx ? computeCleaning({
        rawWeightLb: rawLb, wasteWeightLb: wasteLb,
        outputs: ctx.products.map(p => ({ qty: qty[p.id] ?? 0, portionWeightG: p.portionWeightG, yieldPercent: p.yieldPercent })),
        band: ctx.band,
    }) : null, [ctx, rawLb, wasteLb, qty]);
    const anyPortion = Object.values(qty).some(q => q > 0);
    const ready = rawLb > 0 && anyPortion && cooks.length > 0;

    const perUnitHint = useMemo(() => {
        if (!ctx) return null;
        const lp = ctx.lastPurchase;
        if (!lp) return null;
        const lb = lp.totalWeightLb ?? (/^lb/i.test(lp.unit.trim()) ? lp.qty : null);
        const per = ctx.avgLbPerUnit ?? (lb && !/^lb/i.test(lp.unit.trim()) && lp.qty > 0 ? lb / lp.qty : null);
        return t('lastPurchase', { qty: fmt(lp.qty), unit: lp.unit || 'lb', lb: lb != null ? fmt(lb) : '—', per: per != null ? fmt(per) : '—' });
    }, [ctx, t]);

    const confirm = async () => {
        if (!ctx || !ready || busy) return;
        setBusy(true);
        setError(null);
        const res = await completeCleaningSession({
            rawIngredientId: ctx.raw.id,
            rawUnits: units > 0 ? units : null,
            rawWeightLb: rawLb,
            wasteWeightLb: wasteLb,
            outputs: ctx.products.map(p => ({ ingredientId: p.id, qty: qty[p.id] ?? 0 })),
            cookIds: cooks,
        });
        setBusy(false);
        if (!res.success) { setError(res.error); return; }
        onDone();
    };

    // ── styles ──
    const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9999, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '1rem', overflowY: 'auto' };
    const card: React.CSSProperties = { background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '18px', padding: '1.25rem 1.25rem 1rem', width: '100%', maxWidth: '620px', display: 'flex', flexDirection: 'column', gap: '0.25rem', fontFamily: 'inherit' };
    const numBox: React.CSSProperties = { width: 130, height: 48, borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '1.5rem', fontWeight: 700, textAlign: 'center', fontFamily: 'inherit' };
    const stepBtn = (on: boolean): React.CSSProperties => ({ width: 44, height: 44, borderRadius: '10px', border: on ? '1px solid var(--accent-primary)' : '1px solid var(--border)', background: on ? 'var(--accent-primary)' : 'transparent', color: on ? '#fff' : 'var(--text-primary)', fontFamily: 'inherit', fontSize: '1.3rem', cursor: 'pointer' });
    const stepNum: React.CSSProperties = { width: 110, height: 48, borderRadius: '10px', border: '1px solid var(--border)', background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: '1.25rem', fontWeight: 700 };
    const sub: React.CSSProperties = { fontSize: '0.8rem', color: 'var(--text-secondary)' };
    const tag = (bg: string, label: string) => <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', padding: '2px 7px', borderRadius: '999px', background: bg, color: '#fff', flexShrink: 0 }}>{label}</span>;
    const step = (n: number, title: string, hint: string, body: React.ReactNode) => (
        <div style={{ display: 'flex', gap: '0.8rem', padding: '0.8rem 0', borderTop: '1px solid var(--border)' }}>
            <div style={{ width: 28, height: 28, borderRadius: 999, background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))', color: '#fff', fontSize: '0.85rem', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>{n}</div>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div><div style={{ fontSize: '1rem', fontWeight: 600 }}>{title}</div><div style={sub}>{hint}</div></div>
                {body}
            </div>
        </div>
    );

    const FLAG: Record<CleaningFlag, { bg: string; fg: string; border: string }> = {
        OK: { bg: 'rgba(16,185,129,0.12)', fg: 'var(--success)', border: 'rgba(16,185,129,0.35)' },
        LOW: { bg: 'rgba(245,158,11,0.14)', fg: 'var(--warning)', border: 'rgba(245,158,11,0.4)' },
        HIGH: { bg: 'rgba(245,158,11,0.14)', fg: 'var(--warning)', border: 'rgba(245,158,11,0.4)' },
        MISSING: { bg: 'rgba(239,68,68,0.12)', fg: 'var(--danger)', border: 'rgba(239,68,68,0.4)' },
    };

    const balanceText = (() => {
        if (!math || !ctx) return '';
        const vals = { raw: fmt(rawLb), produced: fmt(math.producedWeightLb), waste: fmt(wasteLb), diff: fmt(Math.abs(math.unaccountedLb)) };
        if (rawLb <= 0) return '';
        if (math.flag === 'MISSING') return t('balanceMissing', vals);
        if (math.unaccountedLb < -math.toleranceLb) return t('balanceOver', vals);
        return t('balanceOk', vals);
    })();
    const flagText = math?.flag === 'LOW' ? t('lowYield') : math?.flag === 'HIGH' && math.unaccountedLb >= -math.toleranceLb ? t('highYield') : '';

    return (
        <div style={overlay} onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
            <div style={card} role="dialog" aria-modal="true">
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem', paddingBottom: '0.6rem' }}>
                    <div>
                        <div style={{ fontSize: '1.35rem', fontWeight: 700, lineHeight: 1.15 }}>{ctx ? t('title', { name: display(ctx.raw) }) : t('loading')}</div>
                        <div style={{ ...sub, marginTop: 2 }}>{t('subtitle')}</div>
                    </div>
                    {tag('var(--accent-primary)', t('tagRaw'))}
                </div>

                {error && <div style={{ padding: '0.6rem 0.8rem', borderRadius: '10px', border: '1px solid var(--danger)', color: 'var(--danger)', fontSize: '0.9rem', marginBottom: '0.5rem' }}>{error}</div>}

                {ctx && (<>
                    {step(1, t('step1Title'), perUnitHint ? `${t('step1Hint')} ${perUnitHint}` : t('step1Hint'), (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <button type="button" aria-label="−" style={stepBtn(false)} onClick={() => setUnits(u => Math.max(0, u - 1))}>−</button>
                                <div style={stepNum}>{units}<span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-secondary)' }}>{t('pieces')}</span></div>
                                <button type="button" aria-label="+" style={stepBtn(true)} onClick={() => setUnits(u => u + 1)}>+</button>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <input type="number" inputMode="decimal" min="0" step="any" value={rawWeight} onChange={e => setRawWeight(e.target.value)} placeholder="0.0" style={numBox} aria-label={t('rawWeight')} />
                                <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-secondary)' }}>lb</span>
                            </div>
                        </div>
                    ))}

                    {step(2, t('step2Title'), t('step2Hint'), (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                            <input type="number" inputMode="decimal" min="0" step="any" value={waste} onChange={e => setWaste(e.target.value)} placeholder="0.0" style={numBox} aria-label={t('step2Title')} />
                            <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-secondary)' }}>lb</span>
                            {tag('var(--merma)', t('tagMerma'))}
                            <span style={sub}>{ctx.merma ? t('mermaGoesTo', { name: display(ctx.merma) }) : t('noMerma')}</span>
                        </div>
                    ))}

                    {step(3, t('step3Title'), t('step3Hint'), (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {ctx.products.map(p => (
                                <div key={p.id} className="inv-k-proc" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', padding: '0.5rem 0.75rem', borderRadius: '12px', background: 'rgba(139,92,246,0.10)', border: '1px solid rgba(139,92,246,0.45)' }}>
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}><span style={{ fontSize: '0.95rem', fontWeight: 600 }}>{display(p)}</span>{tag('var(--accent-secondary)', t('tagPortions'))}</div>
                                        <div style={sub}>{t('perPortion', { g: fmt(p.portionWeightG, 0) })}</div>
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                                        <button type="button" aria-label="−" style={stepBtn(false)} onClick={() => setQty(q => ({ ...q, [p.id]: Math.max(0, (q[p.id] ?? 0) - 1) }))}>−</button>
                                        <input type="number" inputMode="numeric" min="0" step="1" value={qty[p.id] ?? 0}
                                            onChange={e => setQty(q => ({ ...q, [p.id]: Math.max(0, parseInt(e.target.value || '0', 10) || 0) }))}
                                            style={{ ...stepNum, width: 86, fontSize: '1.2rem', fontFamily: 'inherit', textAlign: 'center' }} aria-label={display(p)} />
                                        <button type="button" aria-label="+" style={stepBtn(true)} onClick={() => setQty(q => ({ ...q, [p.id]: (q[p.id] ?? 0) + 1 }))}>+</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ))}

                    {/* live result */}
                    {math && rawLb > 0 && anyPortion && (
                        <div style={{ margin: '0.6rem 0 0.2rem', padding: '0.8rem 0.9rem', borderRadius: '12px', background: FLAG[math.flag].bg, border: `1px solid ${FLAG[math.flag].border}`, display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
                                <span style={{ fontSize: '0.95rem', fontWeight: 600, color: FLAG[math.flag].fg }}>{t('yield')}</span>
                                <span style={{ fontSize: '1.7rem', fontWeight: 700, lineHeight: 1, color: FLAG[math.flag].fg }}>{fmt(math.yieldPct, 0)}% <span style={{ fontSize: '0.8rem', fontWeight: 500 }}>· {t('expected', { min: fmt(ctx.band.min, 0), max: fmt(ctx.band.max, 0) })}{math.flag === 'OK' ? ' ✓' : ''}</span></span>
                            </div>
                            <div style={{ height: 8, borderRadius: 999, background: 'rgba(127,127,127,0.18)', position: 'relative', overflow: 'hidden' }}>
                                <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.min(100, Math.max(0, math.yieldPct))}%`, background: FLAG[math.flag].fg, borderRadius: 999 }} />
                                <div style={{ position: 'absolute', left: `${ctx.band.min}%`, top: -2, bottom: -2, width: 2, background: 'rgba(127,127,127,0.6)' }} />
                                <div style={{ position: 'absolute', left: `${ctx.band.max}%`, top: -2, bottom: -2, width: 2, background: 'rgba(127,127,127,0.6)' }} />
                            </div>
                            <div style={{ fontSize: '0.85rem', color: FLAG[math.flag].fg }}>{balanceText}{flagText ? ` · ${flagText}` : ''}</div>
                        </div>
                    )}

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', paddingTop: '0.75rem', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <span style={sub}>{t('cooks')}</span>
                            {ctx.cooks.map(c => {
                                const on = cooks.includes(c.id);
                                return (
                                    <button key={c.id} type="button" onClick={() => setCooks(prev => on ? prev.filter(id => id !== c.id) : [...prev, c.id])}
                                        style={{ minHeight: 36, padding: '0 12px', borderRadius: 999, border: on ? '1px solid rgba(16,185,129,0.5)' : '1px solid var(--border)', background: on ? 'rgba(16,185,129,0.12)' : 'transparent', color: on ? 'var(--success)' : 'var(--text-secondary)', fontFamily: 'inherit', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' }}>
                                        {on ? '✓ ' : ''}{c.name}
                                    </button>
                                );
                            })}
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button type="button" onClick={onClose} disabled={busy} style={{ minHeight: 48, padding: '0 1rem', borderRadius: '12px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: '0.95rem', fontWeight: 600, cursor: 'pointer' }}>{t('cancel')}</button>
                            <button type="button" onClick={confirm} disabled={!ready || busy}
                                style={{ minHeight: 48, padding: '0 1.1rem', borderRadius: '12px', border: 'none', background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))', color: '#fff', fontFamily: 'inherit', fontSize: '0.95rem', fontWeight: 600, cursor: ready && !busy ? 'pointer' : 'default', opacity: ready && !busy ? 1 : 0.5 }}>
                                {busy ? t('saving') : t('confirm')}
                            </button>
                        </div>
                    </div>
                    {!ready && (rawLb > 0 || anyPortion || cooks.length > 0) && (
                        <div style={{ ...sub, textAlign: 'right', paddingTop: 4 }}>
                            {rawLb <= 0 ? t('needRaw') : !anyPortion ? t('needPortions') : t('needCook')}
                        </div>
                    )}
                </>)}
            </div>
        </div>
    );
}
