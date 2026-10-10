'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { formatMoney } from '@/lib/money';
import { getAnalyticsLabor } from '@/app/actions/analytics';
import type { AnalyticsLaborResult, LaborArea, LaborDayOut } from '@/lib/analytics/labor';
import { LABOR_TARGET_PCT } from '@/lib/analytics/labor';
import { dayOfWeek, isRead } from '@/lib/analytics/daily';
import type { DateRange } from '@/lib/analytics/range';
import type { DailySalesRow } from '@/lib/pos/toastDailySales';
import { Tile, useAnalyticsDaily, useDateLabels, numStyle, panelStyle, labelStyle, PAID_COLOR, OPEN_COLOR, CASH_COLOR, GRID_COLOR } from './charts';

/**
 * Analytics › Personal: what the people cost against what the days sold.
 *
 * Hours come from the imported punches, wages from Nómina's own pricing
 * (src/lib/analytics/labor.ts), sales from the same PosDailySales rows as
 * every other dashboard. Labor % = wages ÷ net sales, per day and for the
 * window; a day with hours but no sales read yet, or sales but no punches
 * imported, has no percentage rather than a misleading one.
 */

const headCell: CSSProperties = { padding: '0.6rem 0.75rem', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-secondary)', fontWeight: 600 };
const cell: CSSProperties = { padding: '0.6rem 0.75rem', fontSize: '0.95rem' };
const numCell: CSSProperties = { ...cell, ...numStyle, textAlign: 'right' };

const hoursText = (h: number) => `${h.toLocaleString('en-US', { maximumFractionDigits: 1 })} h`;
const pctOf = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
const pctLabel = (pct: number | null) => (pct === null ? '—' : `${pct.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`);

function useAnalyticsLabor(range: DateRange) {
    const t = useTranslations('Analytics');
    const [data, setData] = useState<AnalyticsLaborResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        getAnalyticsLabor(range.from, range.to)
            .then(res => {
                if (cancelled) return;
                if (res.success) { setData(res); setError(null); }
                else setError(res.code === 'NOT_ADMIN' ? t('err_admin') : res.code === 'BAD_DATE' ? t('err_range') : t('per_err_read'));
            })
            .catch(() => { if (!cancelled) setError(t('err_rejected')); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [range.from, range.to]);
    return { data, error, loading };
}

export default function PersonalView({ locale, range, today }: { locale: string; range: DateRange; today: string }) {
    const t = useTranslations('Analytics');
    const sales = useAnalyticsDaily(range);
    const labor = useAnalyticsLabor(range);
    const { dayLabel, weekdayName } = useDateLabels(locale);

    const error = sales.error ?? labor.error;
    if (error) return <p style={{ margin: 0, color: 'var(--danger)' }}>{error}</p>;
    if (!sales.data || !labor.data) return <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('loading')}</p>;

    const salesByDate = new Map(sales.data.rows.map(r => [r.date, r]));
    /** The day's sales row when it has been read; null otherwise. */
    const readRow = (date: string): DailySalesRow | null => { const r = salesByDate.get(date); return r && isRead(r) ? r : null; };
    const days = labor.data.days;
    const totals = labor.data.totals;

    // Only days that have BOTH read sales and punches enter the percentage.
    const paired = days.filter(d => d.hours > 0 && readRow(d.date) !== null);
    const pairedNet = paired.reduce((sum, d) => sum + readRow(d.date)!.netPaidCents, 0);
    const pairedWage = paired.reduce((sum, d) => sum + d.wageCents, 0);
    const pairedHours = paired.reduce((sum, d) => sum + d.hours, 0);
    const laborPct = pctOf(pairedWage, pairedNet);
    const daysWithHours = days.filter(d => d.hours > 0).length;
    const readWithoutHours = days.filter(d => d.hours === 0 && readRow(d.date) !== null).length;
    const netTotal = sales.data.rows.filter(isRead).reduce((sum, r) => sum + r.netPaidCents, 0);
    const salesPerHour = pairedHours > 0 ? Math.round(pairedNet / pairedHours) : null;
    const tips = days.reduce((acc, d) => {
        if (d.tips) { acc.card += d.tips.creditTipsCents; acc.service += d.tips.serviceChargeCents; acc.cash += d.tips.cashTipsCents; acc.days += 1; }
        return acc;
    }, { card: 0, service: 0, cash: 0, days: 0 });
    const salonHours = days.reduce((s, d) => s + d.byArea.SALON.hours, 0);

    // Weekday averages of labor % over the paired days.
    const byDow = Array.from({ length: 7 }, () => ({ wage: 0, net: 0, days: 0 }));
    for (const d of paired) {
        const b = byDow[dayOfWeek(d.date)];
        b.wage += d.wageCents; b.net += readRow(d.date)!.netPaidCents; b.days += 1;
    }
    const dowOrder = locale.startsWith('en') ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 0];

    const areas: { key: LaborArea; label: string; color: string }[] = [
        { key: 'COCINA', label: t('per_area_cocina'), color: PAID_COLOR },
        { key: 'SALON', label: t('per_area_salon'), color: 'var(--accent-secondary)' },
        { key: 'OTRO', label: t('per_area_otro'), color: 'var(--text-secondary)' }
    ];
    const areaTotals = areas.map(a => ({ ...a, hours: days.reduce((s, d) => s + d.byArea[a.key].hours, 0), wageCents: days.reduce((s, d) => s + d.byArea[a.key].wageCents, 0) }));

    const loading = sales.loading || labor.loading;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', opacity: loading ? 0.6 : 1, transition: 'opacity 0.2s' }}>
            <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                {t('per_showing', { days: daysWithHours })}
                {readWithoutHours > 0 && <> · {t('per_no_punches', { count: readWithoutHours })}</>}
                {totals.unpricedHours > 0 && <> · <span style={{ color: OPEN_COLOR, fontWeight: 600 }}>{t('per_unpriced', { hours: hoursText(totals.unpricedHours) })}</span></>}
            </p>

            {daysWithHours === 0 ? (
                <div className="glass-panel" style={panelStyle}>
                    <p style={{ margin: 0 }}>{t('per_empty')}</p>
                </div>
            ) : (
                <>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                        <Tile title={t('per_kpi_pct')} value={pctLabel(laborPct)} color={laborPct !== null && laborPct > LABOR_TARGET_PCT ? OPEN_COLOR : PAID_COLOR} tone={laborPct !== null && laborPct > LABOR_TARGET_PCT ? 'warn' : undefined}
                            sub={t('per_kpi_pct_sub', { wages: formatMoney(pairedWage), target: LABOR_TARGET_PCT, days: paired.length })}
                            series={days.map(d => { const r = readRow(d.date); return r && d.hours > 0 && r.netPaidCents > 0 ? Math.round((d.wageCents / r.netPaidCents) * 1000) / 10 : null; })} />
                        <Tile title={t('per_kpi_hours')} value={hoursText(totals.hours)} color={PAID_COLOR}
                            sub={t('per_kpi_hours_sub', { perDay: hoursText(totals.hours / Math.max(daysWithHours, 1)), people: labor.data.people.length })}
                            series={days.map(d => (d.hours > 0 ? d.hours : null))} />
                        <Tile title={t('per_kpi_wages')} value={formatMoney(totals.wageCents)} color={PAID_COLOR}
                            sub={t('per_kpi_wages_sub', { perHour: totals.hours > 0 ? formatMoney(Math.round(totals.wageCents / totals.hours)) : '—' })}
                            series={days.map(d => (d.hours > 0 ? d.wageCents : null))} />
                        <Tile title={t('per_kpi_sph')} value={salesPerHour !== null ? formatMoney(salesPerHour) : '—'} color={PAID_COLOR}
                            sub={t('per_kpi_sph_sub', { net: formatMoney(netTotal) })} />
                        <Tile title={t('per_kpi_tips')} value={formatMoney(tips.card + tips.service)} color={CASH_COLOR}
                            sub={tips.days > 0
                                ? t('per_kpi_tips_sub', { card: formatMoney(tips.card), service: formatMoney(tips.service), cash: formatMoney(tips.cash), perHour: salonHours > 0 ? formatMoney(Math.round((tips.card + tips.service) / salonHours)) : '—' })
                                : t('per_kpi_tips_none')} />
                    </div>

                    <LaborPctBars days={days} salesByDate={salesByDate} today={today} dayLabel={dayLabel} />

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem', alignItems: 'start' }}>
                        <div className="glass-panel" style={panelStyle}>
                            <h2 style={{ margin: 0, fontSize: '1.2rem' }}>{t('per_area_title')}</h2>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                                {areaTotals.filter(a => a.hours > 0).map(a => (
                                    <div key={a.key} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.95rem' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                                            <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: a.color, marginRight: 6 }} />{a.label} · {hoursText(a.hours)}</span>
                                            <span style={{ ...numStyle, fontWeight: 600 }}>{formatMoney(a.wageCents)} <span style={{ color: 'var(--text-secondary)', fontWeight: 400, fontSize: '0.85rem' }}>· {pctLabel(pctOf(a.wageCents, totals.wageCents))}</span></span>
                                        </div>
                                        <div style={{ height: '8px', borderRadius: '4px', background: 'rgba(127,127,127,0.12)', overflow: 'hidden' }}>
                                            <div style={{ width: `${totals.wageCents > 0 ? (a.wageCents / totals.wageCents) * 100 : 0}%`, height: '100%', background: a.color }} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('per_area_note')}</p>
                        </div>

                        <div className="glass-panel" style={panelStyle}>
                            <div>
                                <h2 style={{ margin: 0, fontSize: '1.2rem' }}>{t('per_dow_title')}</h2>
                                <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('per_dow_sub')}</p>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                                {dowOrder.map(dow => {
                                    const b = byDow[dow];
                                    const pct = pctOf(b.wage, b.net);
                                    const over = pct !== null && pct > LABOR_TARGET_PCT;
                                    return (
                                        <div key={dow} style={{ display: 'grid', gridTemplateColumns: '3.2rem 1fr auto', alignItems: 'center', gap: '0.6rem', fontSize: '0.95rem' }}>
                                            <span style={{ textTransform: 'capitalize' }}>{weekdayName(dow)}</span>
                                            <div style={{ height: '10px', borderRadius: '5px', background: 'rgba(127,127,127,0.12)', overflow: 'hidden' }}>
                                                <div style={{ width: `${Math.min(100, pct ?? 0)}%`, height: '100%', background: over ? OPEN_COLOR : PAID_COLOR }} />
                                            </div>
                                            <span style={{ ...numStyle, textAlign: 'right' }}>
                                                <strong style={{ color: over ? OPEN_COLOR : undefined }}>{pctLabel(pct)}</strong>
                                                <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}> · {t('dow_days', { count: b.days })}</span>
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    <div className="glass-panel" style={{ padding: '0.5rem 0', overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '760px' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                    <th style={{ ...headCell, textAlign: 'left' }}>{t('per_th_person')}</th>
                                    <th style={{ ...headCell, textAlign: 'left' }}>{t('per_th_area')}</th>
                                    <th style={{ ...headCell, textAlign: 'right' }}>{t('per_th_days')}</th>
                                    <th style={{ ...headCell, textAlign: 'right' }}>{t('per_th_hours')}</th>
                                    <th style={{ ...headCell, textAlign: 'right' }}>{t('per_th_rate')}</th>
                                    <th style={{ ...headCell, textAlign: 'right' }}>{t('per_th_wages')}</th>
                                    <th style={{ ...headCell, textAlign: 'right' }}>{t('per_th_tips')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {labor.data.people.map(p => (
                                    <tr key={p.key} style={{ borderBottom: '1px solid var(--border)' }}>
                                        <td style={{ ...cell, fontWeight: 600, whiteSpace: 'nowrap' }}>{p.name}</td>
                                        <td style={{ ...cell, color: 'var(--text-secondary)' }}>{areas.find(a => a.key === p.area)!.label}{p.role && <> · {p.role === 'BUSSER' ? t('per_role_busser') : t('per_role_server')}</>}</td>
                                        <td style={numCell}>{p.days}</td>
                                        <td style={numCell}>{hoursText(p.hours)}</td>
                                        <td style={{ ...numCell, color: p.rateUsed === null ? OPEN_COLOR : 'var(--text-secondary)' }}>
                                            {p.rateUsed === null ? t('per_no_rate') : <>{formatMoney(Math.round(p.rateUsed * 100))}/h{!p.configured && <span style={{ fontSize: '0.8rem' }}> · {t('per_rate_role')}</span>}</>}
                                        </td>
                                        <td style={{ ...numCell, fontWeight: 600 }}>{p.rateUsed === null ? '—' : formatMoney(p.wageCents)}</td>
                                        <td style={numCell}>{p.tipsCents > 0 ? formatMoney(p.tipsCents) : <span style={{ color: 'var(--text-secondary)' }}>—</span>}</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                                    <td style={cell}>{t('per_row_total', { people: labor.data.people.length })}</td>
                                    <td style={cell}></td>
                                    <td style={numCell}>{daysWithHours}</td>
                                    <td style={numCell}>{hoursText(totals.hours)}</td>
                                    <td style={{ ...numCell, color: 'var(--text-secondary)' }}>{totals.hours > 0 ? `${formatMoney(Math.round(totals.wageCents / totals.hours))}/h` : '—'}</td>
                                    <td style={numCell}>{formatMoney(totals.wageCents)}</td>
                                    <td style={numCell}>{formatMoney(labor.data.people.reduce((s, p) => s + p.tipsCents, 0))}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </>
            )}

            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                {t('per_footnote', { server: formatMoney(Math.round(labor.data.rates.serverRate * 100)), busser: formatMoney(Math.round(labor.data.rates.busserRate * 100)) })}
            </p>
        </div>
    );
}

/**
 * Labor cost as a share of the day's net sales, one bar per day, with the
 * reference line at LABOR_TARGET_PCT. A day missing either side is a dashed
 * stub, not a bar at zero. Bars over the line turn amber and carry their
 * figure — colour alone never says it.
 */
function LaborPctBars({ days, salesByDate, today, dayLabel }: {
    days: LaborDayOut[]; salesByDate: Map<string, DailySalesRow>; today: string; dayLabel: (date: string, opts?: Intl.DateTimeFormatOptions) => string;
}) {
    const t = useTranslations('Analytics');
    const H = 200;
    const pcts = days.map(d => {
        const r = salesByDate.get(d.date);
        return r && isRead(r) && d.hours > 0 && r.netPaidCents > 0 ? { pct: (d.wageCents / r.netPaidCents) * 100, day: d, row: r } : null;
    });
    const max = Math.max(LABOR_TARGET_PCT * 1.5, ...pcts.map(p => p?.pct ?? 0));
    const px = (pct: number) => (Math.min(pct, max) / max) * H;
    const every = Math.max(1, Math.ceil(days.length / 14));
    const gap = days.length > 40 ? '2px' : '6px';
    return (
        <div className="glass-panel" style={panelStyle}>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: '1.2rem' }}>{t('per_chart_title')}</h2>
                    <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('per_chart_sub')}</p>
                </div>
                <div style={{ display: 'flex', gap: '1rem', fontSize: '0.85rem', color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
                    <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: PAID_COLOR, marginRight: 6 }} />{t('per_legend_under', { target: LABOR_TARGET_PCT })}</span>
                    <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: OPEN_COLOR, marginRight: 6 }} />{t('per_legend_over', { target: LABOR_TARGET_PCT })}</span>
                </div>
            </div>
            <div style={{ position: 'relative', height: `${H}px`, marginRight: '48px', borderBottom: `1px solid ${GRID_COLOR}` }}>
                {[0.25, 0.5, 0.75, 1].map(f => (
                    <div key={f} style={{ position: 'absolute', left: 0, right: 0, bottom: `${f * H}px`, borderTop: `1px solid ${GRID_COLOR}`, opacity: 0.6 }}>
                        <span style={{ ...numStyle, position: 'absolute', left: '100%', paddingLeft: '8px', top: '-0.6em', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{Math.round(max * f)}%</span>
                    </div>
                ))}
                <div style={{ position: 'absolute', left: 0, right: 0, bottom: `${px(LABOR_TARGET_PCT)}px`, borderTop: '2px dashed var(--text-secondary)', zIndex: 1 }} />
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', gap, padding: '0 4px' }}>
                    {days.map((d, i) => {
                        const p = pcts[i];
                        const over = !!p && p.pct > LABOR_TARGET_PCT;
                        const title = p
                            ? t('per_chart_tip', { day: dayLabel(d.date), pct: pctLabel(Math.round(p.pct * 10) / 10), wages: formatMoney(d.wageCents), hours: hoursText(d.hours), net: formatMoney(p.row.netPaidCents) })
                            : `${dayLabel(d.date)} · ${d.hours > 0 ? t('per_chart_no_sales') : t('per_chart_no_hours')}`;
                        return (
                            <div key={d.date} title={title} style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'stretch', height: '100%', outline: d.date === today ? '2px solid var(--accent-secondary)' : undefined, outlineOffset: '2px', borderRadius: '4px' }}>
                                {p ? (
                                    <>
                                        {over && <span style={{ ...numStyle, fontSize: '0.7rem', textAlign: 'center', color: OPEN_COLOR, fontWeight: 600, marginBottom: '2px' }}>{Math.round(p.pct)}%</span>}
                                        <div style={{ height: `${px(p.pct)}px`, background: over ? OPEN_COLOR : PAID_COLOR, borderRadius: '4px' }} />
                                    </>
                                ) : (
                                    <div style={{ height: '6px', border: '1px dashed var(--text-secondary)', borderRadius: '3px', opacity: 0.6 }} />
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
            <div style={{ display: 'flex', gap, padding: '0 4px', marginRight: '48px' }}>
                {days.map((d, i) => {
                    const show = i % every === 0 || d.date === today || i === days.length - 1;
                    return (
                        <span key={d.date} style={{ flex: '1 1 0', minWidth: 0, fontSize: '0.75rem', textAlign: 'center', color: d.date === today ? 'var(--accent-primary)' : 'var(--text-secondary)', fontWeight: d.date === today ? 700 : 400, whiteSpace: 'nowrap' }}>
                            {show ? dayLabel(d.date, days.length > 14 ? { day: 'numeric' } : { day: 'numeric', month: 'short' }) : ''}
                        </span>
                    );
                })}
            </div>
            <span style={{ ...labelStyle, fontSize: '0.75rem' }}>{t('per_chart_target', { target: LABOR_TARGET_PCT })}</span>
        </div>
    );
}
