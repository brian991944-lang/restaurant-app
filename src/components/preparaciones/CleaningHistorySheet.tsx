'use client';

import React, { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getCleaningHistory, type CleaningBatch, type CleaningHistoryRow } from '@/app/actions/cleaning';
import { formatMoney } from '@/lib/money';

// Admin: the cleaning sessions of one raw protein, with the review flag per row.
// Opened from the Inventario group box ("Ver historial"). Read-only.

interface Props { rawId: string; rawName: string; locale: 'es' | 'en'; onClose: () => void }

const fmt = (n: number, d = 1) => Number(n.toFixed(d)).toString();

export function FlagChip({ flag, unaccountedLb, t }: { flag: string; unaccountedLb?: number; t: ReturnType<typeof useTranslations> }) {
    const k = flag === 'MISSING' ? { bg: 'rgba(239,68,68,0.12)', fg: 'var(--danger)', label: t('flagMissing', { lb: fmt(Math.abs(unaccountedLb ?? 0)) }) }
        : flag === 'LOW' ? { bg: 'rgba(245,158,11,0.16)', fg: 'var(--warning)', label: t('flagLow') }
        : flag === 'HIGH' ? { bg: 'rgba(245,158,11,0.16)', fg: 'var(--warning)', label: t('flagHigh') }
        : { bg: 'rgba(16,185,129,0.14)', fg: 'var(--success)', label: t('flagOk') };
    return <span style={{ padding: '3px 9px', borderRadius: 999, background: k.bg, color: k.fg, fontSize: '0.75rem', fontWeight: 600, whiteSpace: 'nowrap' }}>{k.label}</span>;
}

export default function CleaningHistorySheet({ rawId, rawName, locale, onClose }: Props) {
    const t = useTranslations('Limpieza');
    const [days, setDays] = useState<30 | 90>(30);
    const [rows, setRows] = useState<CleaningHistoryRow[] | null>(null);
    const [summary, setSummary] = useState<{ avgYield: number | null; wastePct: number | null; missing: number; count: number } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [batch, setBatch] = useState<CleaningBatch | null>(null);

    useEffect(() => {
        let alive = true;
        setRows(null);
        getCleaningHistory(rawId, days).then(res => {
            if (!alive) return;
            if (!res.success) { setError(res.error); return; }
            setRows(res.rows); setSummary(res.summary); setBatch(res.batch);
        });
        return () => { alive = false; };
    }, [rawId, days]);

    const dateFmt = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' });
    const display = (o: { name: string; nameEs: string | null }) => (locale === 'es' && o.nameEs ? o.nameEs : o.name);
    const seg = (on: boolean): React.CSSProperties => ({ minHeight: 36, padding: '0 0.9rem', borderRadius: 9, border: 'none', background: on ? 'var(--bg-primary)' : 'transparent', color: on ? 'var(--text-primary)' : 'var(--text-secondary)', fontFamily: 'inherit', fontSize: '0.85rem', fontWeight: on ? 600 : 500, cursor: 'pointer', boxShadow: on ? '0 1px 2px rgba(0,0,0,0.12)' : 'none' });
    const th: React.CSSProperties = { fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-secondary)', textAlign: 'left', padding: '0.5rem 0.6rem', whiteSpace: 'nowrap' };
    const td: React.CSSProperties = { fontSize: '0.9rem', padding: '0.6rem', borderTop: '1px solid var(--border)', verticalAlign: 'top' };

    return (
        <div onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9999, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '1rem', overflowY: 'auto' }}>
            <div role="dialog" aria-modal="true" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 18, padding: '1.1rem 1.1rem 0.9rem', width: '100%', maxWidth: 900, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                    <div>
                        <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{t('historyTitle', { name: rawName })}</div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                            {summary && summary.count > 0
                                ? t('historySummary', { days, yield: summary.avgYield != null ? fmt(summary.avgYield, 0) : '—', waste: summary.wastePct != null ? fmt(summary.wastePct, 0) : '—', missing: summary.missing })
                                : t('empty')}
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <div style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 11, background: 'rgba(127,127,127,0.12)' }}>
                            <button type="button" style={seg(days === 30)} onClick={() => setDays(30)}>{t('days30')}</button>
                            <button type="button" style={seg(days === 90)} onClick={() => setDays(90)}>{t('days90')}</button>
                        </div>
                        <button type="button" onClick={onClose} aria-label={t('cancel')} style={{ width: 36, height: 36, borderRadius: 18, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontFamily: 'inherit', fontSize: '1rem', cursor: 'pointer' }}>✕</button>
                    </div>
                </div>

                {error && <div style={{ color: 'var(--danger)', fontSize: '0.9rem' }}>{error}</div>}
                {!rows && !error && <div style={{ color: 'var(--text-secondary)', padding: '1rem 0' }}>{t('loading')}</div>}

                {batch && (
                    <div style={{ padding: '0.7rem 0.9rem', borderRadius: 12, background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.3)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ fontSize: '0.95rem', fontWeight: 700 }}>
                            {t('batchTitle', { date: dateFmt.format(new Date(batch.purchasedAt)), supplier: batch.supplierName ?? '—', count: batch.pieces, lb: fmt(batch.rawLb, 2) })}
                            {batch.costCents != null ? ` · ${formatMoney(batch.costCents)}` : ''}
                        </div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                            {t('batchProgress', { cleaned: batch.cleaned, count: batch.pieces, raw: fmt(batch.cleanedRawLb, 2), produced: fmt(batch.producedLb, 2), waste: fmt(batch.wasteLb, 2) })}
                            {Math.abs(batch.looseLb) >= 0.01 ? ` · ${t('batchLoose', { g: Math.round(batch.looseLb * 453.59237) })}` : ''}
                            {batch.yieldPct != null ? <> · <strong style={{ color: 'var(--text-primary)' }}>{t('batchYield', { pct: fmt(batch.yieldPct, 1) })}</strong></> : ''}
                        </div>
                    </div>
                )}

                {rows && rows.length > 0 && (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead><tr>
                                <th style={th}>{t('colDate')}</th><th style={th}>{t('colCook')}</th><th style={th}>{batch ? t('colBall') : t('colUnits')}</th><th style={th}>{t('colRaw')}</th>
                                <th style={th}>{t('colWaste')}</th><th style={th}>{t('colPortions')}</th><th style={th}>{t('colYield')}</th><th style={th}>{t('colReview')}</th>
                            </tr></thead>
                            <tbody>
                                {rows.map(r => (
                                    <tr key={r.id}>
                                        <td style={{ ...td, fontWeight: 600, whiteSpace: 'nowrap' }}>{dateFmt.format(new Date(r.createdAt))}</td>
                                        <td style={td}>{r.cookNames ?? '—'}</td>
                                        <td style={{ ...td, fontWeight: r.pieceNumber != null ? 700 : 400 }}>{r.pieceNumber != null ? `#${r.pieceNumber}` : r.rawUnits != null ? fmt(r.rawUnits, 0) : '—'}</td>
                                        <td style={td}>{fmt(r.rawWeightLb)}</td>
                                        <td style={td}>{fmt(r.wasteWeightLb)}</td>
                                        <td style={td}>
                                            {r.outputs.filter(o => !o.isWaste && o.qty > 0).map(o => `${fmt(o.qty, 0)} ${display(o)}`).join(' · ') || '—'}
                                            {r.outputs.some(o => o.leftoverG > 0) && (
                                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                                                    {t('leftoverBy', { list: r.outputs.filter(o => o.leftoverG > 0).map(o => `${Math.round(o.leftoverG)} g ${display(o)}`).join(' · ') })}
                                                </div>
                                            )}
                                        </td>
                                        <td style={{ ...td, fontWeight: 700, whiteSpace: 'nowrap' }}>
                                            {fmt(r.yieldMinPct, 0) === fmt(r.yieldMaxPct, 0) ? fmt(r.yieldPct, 0) : `${fmt(r.yieldMinPct, 0)}–${fmt(r.yieldMaxPct, 0)}`}%
                                        </td>
                                        <td style={td}>
                                            <FlagChip flag={r.flag} unaccountedLb={r.unaccountedMinLb} t={t} />
                                            {r.flag === 'OK' && Math.abs(r.unaccountedMaxLb - r.unaccountedMinLb) >= 0.01 && (
                                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4, whiteSpace: 'nowrap' }}>
                                                    {t('unaccountedRange', { min: fmt(Math.max(0, r.unaccountedMinLb), 2), max: fmt(Math.max(0, r.unaccountedMaxLb), 2) })}
                                                </div>
                                            )}
                                            {[
                                                r.carryInLb >= 0.005 ? t('looseUsed', { g: Math.round(r.carryInLb * 453.59237) }) : null,
                                                r.carryOutLb >= 0.005 && !r.outputs.some(o => o.leftoverG > 0) ? t('looseLeft', { g: Math.round(r.carryOutLb * 453.59237) }) : null,
                                                Math.abs(r.countLb) >= 0.005 ? t('looseCorrection', { g: `${r.countLb > 0 ? '+' : '−'}${Math.round(Math.abs(r.countLb) * 453.59237)}` }) : null,
                                            ].filter(Boolean).map((line, i) => (
                                                <div key={i} style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 4, whiteSpace: 'nowrap' }}>{line}</div>
                                            ))}
                                            {Math.abs(r.countLb) >= 0.005 && (
                                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 2, whiteSpace: 'nowrap' }}>{t('looseNet', { lb: fmt(r.unaccountedLb - r.countLb, 2) })}</div>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.78rem', color: 'var(--text-secondary)', paddingTop: '0.25rem' }}>
                    <span><FlagChip flag="OK" t={t} /> {t('legendOk')}</span>
                    <span><FlagChip flag="LOW" t={t} /> {t('legendLow')}</span>
                    <span><FlagChip flag="MISSING" unaccountedLb={1} t={t} /> {t('legendMissing')}</span>
                </div>
            </div>
        </div>
    );
}
