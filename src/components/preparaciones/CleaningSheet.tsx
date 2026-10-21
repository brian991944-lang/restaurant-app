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
    // Ball picked from the purchase ('MANUAL' = a ball that isn't registered: weigh it).
    const [pieceId, setPieceId] = useState<string | 'MANUAL' | null>(null);
    // The kitchen weighs merma in grams; lb stays available.
    const [wasteUnit, setWasteUnit] = useState<'g' | 'lb'>('g');
    // Per product: grams of its cut left short of a portion, kept as loose raw meat for the next ball.
    const [left, setLeft] = useState<Record<string, string>>({});
    // Loose meat from before goes into this ball unless the cook unticks it.
    const [useLoose, setUseLoose] = useState(true);

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
    const hasPieces = (ctx?.pieces.length ?? 0) > 0;
    const piece = ctx && pieceId && pieceId !== 'MANUAL' ? ctx.pieces.find(p => p.id === pieceId) ?? null : null;
    // A registered ball with a weight: that weight, nothing to type.
    const rawLb = piece?.weightLb != null ? piece.weightLb : parseFloat(rawWeight) || 0;
    const wasteLb = (parseFloat(waste) || 0) / (wasteUnit === 'g' ? 453.59237 : 1);
    const looseG = ctx ? Math.round(ctx.looseLb * 453.59237) : 0;
    const carryInLb = ctx && useLoose && looseG >= 5 ? ctx.looseLb : 0;
    const leftG = (id: string) => Math.max(0, parseFloat(left[id] ?? '') || 0);
    const carryOutLb = ctx ? ctx.products.reduce((a, p) => a + leftG(p.id), 0) / 453.59237 : 0;
    // The meat that really went through: ball + loose used − leftover kept.
    const usedLb = rawLb > 0 ? rawLb + carryInLb - carryOutLb : 0;

    const math = useMemo(() => ctx ? computeCleaning({
        rawWeightLb: usedLb, wasteWeightLb: wasteLb,
        outputs: ctx.products.map(p => ({ qty: qty[p.id] ?? 0, portionWeightG: p.portionWeightG, yieldPercent: p.yieldPercent })),
        band: ctx.band,
    }) : null, [ctx, usedLb, wasteLb, qty]);
    const anyPortion = Object.values(qty).some(q => q > 0);
    const pickedBall = !hasPieces || pieceId !== null;
    const ready = pickedBall && rawLb > 0 && anyPortion && cooks.length > 0;

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
            pieceId: piece ? piece.id : null,
            rawUnits: piece ? 1 : units > 0 ? units : null,
            rawWeightLb: rawLb,
            wasteWeightLb: wasteLb,
            carryInLb,
            outputs: ctx.products.map(p => ({ ingredientId: p.id, qty: qty[p.id] ?? 0, leftoverG: leftG(p.id) })),
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
        const vals = { raw: fmt(usedLb), produced: fmt(math.producedWeightLb), waste: fmt(wasteLb), diff: fmt(Math.abs(math.unaccountedLb)) };
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
                    {hasPieces && step(1, t('ballTitle'), t('ballHint'), (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                {ctx.pieces.map(p => {
                                    const on = pieceId === p.id;
                                    return (
                                        <button key={p.id} type="button" onClick={() => { setPieceId(p.id); setRawWeight(''); }}
                                            style={{ minHeight: 48, padding: '0 14px', borderRadius: 12, border: on ? '2px solid var(--accent-primary)' : '1px solid var(--border)', background: on ? 'rgba(59,130,246,0.12)' : 'var(--bg-secondary)', color: 'var(--text-primary)', fontFamily: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'baseline', gap: 6 }}>
                                            <span style={{ fontSize: '1.15rem', fontWeight: 700 }}>#{p.number}</span>
                                            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{p.weightLb != null ? `${fmt(p.weightLb, 2)} lb` : t('ballWeigh')}</span>
                                        </button>
                                    );
                                })}
                                <button type="button" onClick={() => { setPieceId('MANUAL'); setRawWeight(''); }}
                                    style={{ minHeight: 48, padding: '0 14px', borderRadius: 12, border: pieceId === 'MANUAL' ? '2px solid var(--accent-primary)' : '1px dashed var(--border)', background: pieceId === 'MANUAL' ? 'rgba(59,130,246,0.12)' : 'transparent', color: 'var(--text-secondary)', fontFamily: 'inherit', fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer' }}>
                                    {t('ballOther')}
                                </button>
                            </div>
                            {piece && piece.weightLb != null && (
                                <div style={{ fontSize: '0.95rem' }}>{t('ballChosen', { n: piece.number, lb: fmt(piece.weightLb, 2) })}</div>
                            )}
                            {looseG >= 5 && (
                                <button type="button" role="checkbox" aria-checked={useLoose} onClick={() => setUseLoose(v => !v)}
                                    style={{ alignSelf: 'flex-start', minHeight: 44, padding: '0 12px', borderRadius: 10, border: useLoose ? '1px solid rgba(16,185,129,0.5)' : '1px solid var(--border)', background: useLoose ? 'rgba(16,185,129,0.12)' : 'transparent', color: useLoose ? 'var(--success)' : 'var(--text-secondary)', fontFamily: 'inherit', fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span aria-hidden="true" style={{ width: 20, height: 20, borderRadius: 5, border: '2px solid currentColor', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>{useLoose ? '✓' : ''}</span>
                                    {t('looseUse', { g: looseG })}
                                    {ctx.looseBreakdown.length > 0 && <span style={{ fontWeight: 500 }}>({ctx.looseBreakdown.map(b => `${display(b)} ${b.g} g`).join(' · ')})</span>}
                                </button>
                            )}
                            {((piece && piece.weightLb == null) || pieceId === 'MANUAL') && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                    <input type="number" inputMode="decimal" min="0" step="any" value={rawWeight} onChange={e => setRawWeight(e.target.value)} placeholder="0.0" style={numBox} aria-label={t('rawWeight')} />
                                    <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-secondary)' }}>lb</span>
                                    <span style={sub}>{t('ballWeighFirst')}</span>
                                </div>
                            )}
                        </div>
                    ))}

                    {!hasPieces && step(1, t('step1Title'), perUnitHint ? `${t('step1Hint')} ${perUnitHint}` : t('step1Hint'), (
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
                            <input type="number" inputMode="decimal" min="0" step="any" value={waste} onChange={e => setWaste(e.target.value)} placeholder={wasteUnit === 'g' ? '0' : '0.0'} style={numBox} aria-label={t('step2Title')} />
                            <div role="radiogroup" aria-label={t('step2Title')} style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 10, background: 'rgba(127,127,127,0.12)' }}>
                                {(['g', 'lb'] as const).map(u => (
                                    <button key={u} type="button" role="radio" aria-checked={wasteUnit === u}
                                        onClick={() => {
                                            if (u === wasteUnit) return;
                                            const v = parseFloat(waste);
                                            if (v > 0) setWaste(u === 'g' ? String(Math.round(v * 453.59237)) : fmt(v / 453.59237, 2));
                                            setWasteUnit(u);
                                        }}
                                        style={{ minWidth: 44, minHeight: 40, borderRadius: 8, border: 'none', fontFamily: 'inherit', fontSize: '0.9rem', fontWeight: wasteUnit === u ? 700 : 500, background: wasteUnit === u ? 'var(--bg-primary)' : 'transparent', color: wasteUnit === u ? 'var(--text-primary)' : 'var(--text-secondary)', cursor: 'pointer' }}>
                                        {u}
                                    </button>
                                ))}
                            </div>
                            {tag('var(--merma)', t('tagMerma'))}
                            <span style={sub}>{ctx.merma ? t('mermaGoesTo', { name: display(ctx.merma) }) : t('noMerma')}</span>
                        </div>
                    ))}

                    {step(3, t('step3Title'), t('step3Hint'), (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {ctx.products.map(p => (
                                <div key={p.id} className="inv-k-proc" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', padding: '0.5rem 0.75rem', borderRadius: '12px', background: 'rgba(139,92,246,0.10)', border: '1px solid rgba(139,92,246,0.45)' }}>
                                    <div style={{ minWidth: 0, flex: '1 1 160px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}><span style={{ fontSize: '0.95rem', fontWeight: 600 }}>{display(p)}</span>{tag('var(--accent-secondary)', t('tagPortions'))}</div>
                                        <div style={sub}>{t('perPortion', { g: fmt(p.portionWeightG, 0) })}</div>
                                    </div>
                                    {/* Left short of a portion: stays as loose meat, not merma. */}
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, ...sub }}>
                                        {t('leftoverShort')}
                                        <input type="number" inputMode="numeric" min="0" step="1" value={left[p.id] ?? ''} placeholder="0"
                                            onChange={e => setLeft(l => ({ ...l, [p.id]: e.target.value }))}
                                            aria-label={`${t('leftoverShort')} · ${display(p)}`}
                                            style={{ width: 72, height: 44, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', fontSize: '1.05rem', fontWeight: 600, textAlign: 'center', fontFamily: 'inherit' }} />
                                        g
                                    </label>
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
                            {!pickedBall ? t('needBall') : rawLb <= 0 ? t('needRaw') : !anyPortion ? t('needPortions') : t('needCook')}
                        </div>
                    )}
                </>)}
            </div>
        </div>
    );
}
