'use client';

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { formatMoney } from '@/lib/money';
import { getAnalyticsDaily } from '@/app/actions/analytics';
import type { AnalyticsDailyResult, DowAverage } from '@/lib/analytics/daily';
import { forecastDays, isRead, summarizeDays, deltaPct, weekdayAverages } from '@/lib/analytics/daily';
import type { DateRange } from '@/lib/analytics/range';
import type { DailySalesRow, SalesErrorCode } from '@/lib/pos/toastDailySales';
import { analyticsHref } from '@/lib/analyticsView';

/**
 * Analytics › Resumen: the window's money at a glance. Every figure comes
 * from the same PosDailySales rows the Ventas table shows, reduced by
 * src/lib/analytics/daily.ts — nothing here is estimated except the forecast,
 * which says so.
 *
 * Two series only, paid and open, in the colours the Ventas table already
 * uses; validated as a colour-blind-safe pair. Open is never added to paid
 * anywhere on this page.
 */

const PAID_COLOR = 'var(--accent-primary)';
const OPEN_COLOR = '#c98500';
const GRID_COLOR = 'var(--border)';

const label: CSSProperties = { fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-secondary)', fontWeight: 600 };
const panel: CSSProperties = { padding: '1.25rem 1.4rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' };
const num: CSSProperties = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };

const pctText = (pct: number) => `${pct > 0 ? '+' : ''}${pct.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;

function Sparkline({ values, color }: { values: (number | null)[]; color: string }) {
    const known = values.filter((v): v is number => v !== null);
    if (known.length < 2) return null;
    const w = 120, h = 28, pad = 2;
    const max = Math.max(...known, 1);
    const step = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
    // One polyline per unbroken run, so an unread day is a gap, not a zero.
    const runs: string[] = [];
    let run: string[] = [];
    values.forEach((v, i) => {
        if (v === null) { if (run.length) runs.push(run.join(' ')); run = []; return; }
        run.push(`${(pad + i * step).toFixed(1)},${(h - pad - (v / max) * (h - pad * 2)).toFixed(1)}`);
    });
    if (run.length) runs.push(run.join(' '));
    return (
        <svg aria-hidden="true" width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block', overflow: 'visible' }}>
            {runs.map((points, i) => <polyline key={i} points={points} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />)}
        </svg>
    );
}

function Tile({ title, value, sub, color, delta, series, tone }: {
    title: string; value: string; sub?: ReactNode; color: string; delta?: ReactNode; series?: (number | null)[]; tone?: 'warn';
}) {
    return (
        <div className="glass-panel" style={{ ...panel, gap: '0.35rem', borderTop: `3px solid ${color}` }}>
            <span style={label}>{title}</span>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '0.75rem' }}>
                <span style={{ ...num, fontSize: '1.9rem', fontWeight: 700, lineHeight: 1.1, color: tone === 'warn' ? OPEN_COLOR : 'var(--text-primary)' }}>{value}</span>
                {series && <Sparkline values={series} color={color} />}
            </div>
            {sub && <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{sub}</span>}
            {delta && <span style={{ fontSize: '0.85rem' }}>{delta}</span>}
        </div>
    );
}

export default function ResumenView({ locale, range, today }: { locale: string; range: DateRange; today: string }) {
    const t = useTranslations('Analytics');
    const [data, setData] = useState<AnalyticsDailyResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    const errorText = (code: SalesErrorCode | undefined) => {
        switch (code) {
            case 'NOT_ADMIN': return t('err_admin');
            case 'BAD_DATE': return t('err_range');
            default: return t('err_read');
        }
    };

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        getAnalyticsDaily(range.from, range.to)
            .then(res => {
                if (cancelled) return;
                if (res.success) { setData(res); setError(null); }
                else setError(errorText(res.code));
            })
            .catch(() => { if (!cancelled) setError(t('err_rejected')); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [range.from, range.to]);

    const dayLabel = (date: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) =>
        new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
    const weekdayName = (dow: number) =>
        new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 2, 1 + dow, 12))); // 2026-03-01 is a Sunday
    const timeLabel = (iso: string) =>
        new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' }).format(new Date(iso));

    if (error) return <p style={{ margin: 0, color: 'var(--danger)' }}>{error}</p>;
    if (!data) return <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('loading')}</p>;

    const rows = data.rows;
    const s = summarizeDays(rows);
    const prev = data.previous && data.previous.rows.every(isRead) ? summarizeDays(data.previous.rows) : null;
    const delta = (current: number, previous: number | null | undefined) => {
        const pct = prev ? deltaPct(current, previous) : null;
        if (pct === null) return <span style={{ color: 'var(--text-secondary)' }}>{t('delta_na')}</span>;
        return <span style={{ color: pct >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>{pctText(pct)} <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>{t('delta_vs')}</span></span>;
    };
    const series = (pick: (r: DailySalesRow) => number) => rows.map(r => (isRead(r) ? pick(r) : null));
    const latest = rows.reduce<string | null>((acc, r) => (r.computedAt && (!acc || r.computedAt > acc) ? r.computedAt : acc), null);
    const cashPct = s.netPaidCents > 0 ? Math.round((s.cashNetCents / s.netPaidCents) * 1000) / 10 : 0;

    const weekdays = weekdayAverages(rows);
    const forecast = forecastDays(rows, today, 7);
    const dowOrder = locale.startsWith('en') ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 0];
    const dowMax = Math.max(1, ...weekdays.map(d => d.avgNetCents ?? 0));

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', opacity: loading ? 0.6 : 1, transition: 'opacity 0.2s' }}>
            <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                {t('showing_read', { count: s.days })}
                {s.unreadDays > 0 && <> · {t('showing_unread', { count: s.unreadDays })}</>}
                {latest && <> · {t('updated', { time: timeLabel(latest) })}</>}
            </p>

            {/* The window's money: what came in, what each check was worth, what is still out. */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                <Tile title={t('kpi_net')} value={formatMoney(s.netPaidCents)} color={PAID_COLOR}
                    sub={s.avgNetPerDayCents !== null ? t('kpi_net_sub', { perDay: formatMoney(s.avgNetPerDayCents) }) : undefined}
                    delta={delta(s.netPaidCents, prev?.netPaidCents)} series={series(r => r.netPaidCents)} />
                <Tile title={t('kpi_ticket')} value={s.avgTicketCents !== null ? formatMoney(s.avgTicketCents) : '—'} color={PAID_COLOR}
                    sub={t('kpi_ticket_sub', { checks: s.paidChecks })}
                    delta={s.avgTicketCents !== null ? delta(s.avgTicketCents, prev?.avgTicketCents) : undefined} series={series(r => r.paidChecks)} />
                <Tile title={t('kpi_open')} value={formatMoney(s.netOpenCents)} color={OPEN_COLOR} tone={s.netOpenCents > 0 ? 'warn' : undefined}
                    sub={s.openChecks > 0 ? t('kpi_open_sub', { checks: s.openChecks, days: s.openDays.length }) : t('kpi_open_none')}
                    series={series(r => r.netOpenCents)} />
                <Tile title={t('kpi_cash')} value={formatMoney(s.cashNetCents)} color="var(--success)"
                    sub={<>{t('kpi_cash_sub', { pct: cashPct.toLocaleString('en-US', { maximumFractionDigits: 1 }), checks: s.cashChecks })}{s.cashDays < s.days && <> · {t('kpi_cash_missing', { count: s.days - s.cashDays })}</>}</>}
                    delta={delta(s.cashNetCents, prev?.cashNetCents)} />
                <Tile title={t('kpi_surcharge')} value={formatMoney(s.surchargeCents)} color="var(--text-secondary)" sub={t('kpi_apart')}
                    delta={delta(s.surchargeCents, prev?.surchargeCents)} />
                <Tile title={t('kpi_service')} value={formatMoney(s.serviceChargeCents)} color="var(--text-secondary)" sub={t('kpi_apart')}
                    delta={delta(s.serviceChargeCents, prev?.serviceChargeCents)} />
            </div>

            <DailyBars rows={rows} today={today} avgCents={s.avgNetPerDayCents} dayLabel={dayLabel} />

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem', alignItems: 'start' }}>
                <div className="glass-panel" style={panel}>
                    <div>
                        <h2 style={{ margin: 0, fontSize: '1.2rem' }}>{t('dow_title')}</h2>
                        <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('dow_sub')}</p>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                        {dowOrder.map(dow => <WeekdayRow key={dow} d={weekdays[dow]} name={weekdayName(dow)} max={dowMax} t={t} />)}
                    </div>
                </div>

                <div className="glass-panel" style={{ ...panel, borderTop: `3px solid ${s.openChecks > 0 || s.unreadDays > 0 ? OPEN_COLOR : 'var(--success)'}` }}>
                    <h2 style={{ margin: 0, fontSize: '1.2rem' }}>{t('alerts_title')}</h2>
                    {s.openChecks === 0 && s.unreadDays === 0 ? (
                        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('alert_none')}</p>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            {s.openChecks > 0 && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                    <span style={{ fontWeight: 600, color: OPEN_COLOR }}>{t('alert_open_title')} · {formatMoney(s.netOpenCents)}</span>
                                    {s.openDays.slice(0, 8).map(d => (
                                        <span key={d.date} style={{ ...num, fontSize: '0.9rem' }}>{t('alert_open_line', { day: dayLabel(d.date), checks: d.openChecks, amount: formatMoney(d.netOpenCents) })}</span>
                                    ))}
                                    {s.openDays.length > 8 && <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>+{s.openDays.length - 8}</span>}
                                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('alert_open_hint')}</span>
                                </div>
                            )}
                            {s.unreadDays > 0 && (
                                <span style={{ fontSize: '0.95rem' }}>
                                    {t('alert_unread', { count: s.unreadDays })} · <Link href={analyticsHref(locale, 'ventas')} style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{t('alert_unread_link')}</Link>
                                </span>
                            )}
                        </div>
                    )}
                </div>

                <div className="glass-panel" style={panel}>
                    <div>
                        <h2 style={{ margin: 0, fontSize: '1.2rem' }}>{t('forecast_title')}</h2>
                        <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('forecast_sub')}</p>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                        {forecast.days.map(d => (
                            <div key={d.date} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', fontSize: '0.95rem' }}>
                                <span>{dayLabel(d.date)}</span>
                                <span style={{ ...num, fontWeight: 600, color: d.expectedCents === null ? 'var(--text-secondary)' : undefined }}>
                                    {d.expectedCents === null ? t('forecast_na') : formatMoney(d.expectedCents)}
                                    <span style={{ fontWeight: 400, color: 'var(--text-secondary)', fontSize: '0.8rem' }}> · {t('forecast_basis', { count: d.basisDays })}</span>
                                </span>
                            </div>
                        ))}
                    </div>
                    <div style={{ borderTop: `1px solid ${GRID_COLOR}`, paddingTop: '0.5rem', display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                        <span style={{ fontWeight: 700 }}>{t('forecast_total', { amount: formatMoney(forecast.totalCents) })}</span>
                        {!forecast.complete && <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{t('forecast_partial')}</span>}
                    </div>
                </div>
            </div>

            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('footnote')}</p>
        </div>
    );
}

function WeekdayRow({ d, name, max, t }: { d: DowAverage; name: string; max: number; t: ReturnType<typeof useTranslations> }) {
    const pct = d.avgNetCents !== null ? (d.avgNetCents / max) * 100 : 0;
    return (
        <div style={{ display: 'grid', gridTemplateColumns: '3.2rem 1fr auto', alignItems: 'center', gap: '0.6rem', fontSize: '0.95rem' }}>
            <span style={{ textTransform: 'capitalize' }}>{name}</span>
            <div style={{ height: '10px', borderRadius: '5px', background: 'rgba(127,127,127,0.12)', overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: PAID_COLOR, borderRadius: '5px' }} />
            </div>
            <span style={{ ...num, textAlign: 'right' }}>
                {d.avgNetCents === null ? <span style={{ color: 'var(--text-secondary)' }}>{t('dow_none')}</span> : <strong>{formatMoney(d.avgNetCents)}</strong>}
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}> · {t('dow_days', { count: d.days })}</span>
            </span>
        </div>
    );
}

function DailyBars({ rows, today, avgCents, dayLabel }: {
    rows: DailySalesRow[]; today: string; avgCents: number | null; dayLabel: (date: string, opts?: Intl.DateTimeFormatOptions) => string;
}) {
    const t = useTranslations('Analytics');
    const H = 220;
    const max = Math.max(1, ...rows.map(r => (isRead(r) ? r.netPaidCents + r.netOpenCents : 0)));
    // Labels thin out on long windows so they never overlap; today always keeps its own.
    const every = Math.max(1, Math.ceil(rows.length / 14));
    const px = (cents: number) => (cents / max) * H;
    const ticks = [0.25, 0.5, 0.75, 1];
    return (
        <div className="glass-panel" style={panel}>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
                <h2 style={{ margin: 0, fontSize: '1.2rem' }}>{t('chart_title')}</h2>
                <div style={{ display: 'flex', gap: '1rem', fontSize: '0.85rem', color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
                    <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: PAID_COLOR, marginRight: 6 }} />{t('legend_paid')}</span>
                    <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: OPEN_COLOR, marginRight: 6 }} />{t('legend_open')}</span>
                    {avgCents !== null && <span><i style={{ display: 'inline-block', width: 16, borderTop: '2px dashed var(--text-secondary)', marginRight: 6, verticalAlign: 'middle' }} />{t('legend_avg', { amount: formatMoney(avgCents) })}</span>}
                </div>
            </div>
            <div style={{ position: 'relative', height: `${H}px`, marginRight: '64px', borderBottom: `1px solid ${GRID_COLOR}` }}>
                {ticks.map(f => (
                    <div key={f} style={{ position: 'absolute', left: 0, right: 0, bottom: `${f * H}px`, borderTop: `1px solid ${GRID_COLOR}`, opacity: 0.6 }}>
                        <span style={{ ...num, position: 'absolute', left: '100%', paddingLeft: '8px', top: '-0.6em', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{formatMoney(Math.round(max * f))}</span>
                    </div>
                ))}
                {avgCents !== null && avgCents <= max && (
                    <div style={{ position: 'absolute', left: 0, right: 0, bottom: `${px(avgCents)}px`, borderTop: '2px dashed var(--text-secondary)', zIndex: 1 }} />
                )}
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', gap: rows.length > 40 ? '2px' : '6px', padding: '0 4px' }}>
                    {rows.map(r => {
                        const read = isRead(r);
                        const title = read
                            ? t('chart_tip', { day: dayLabel(r.date), paid: formatMoney(r.netPaidCents), open: formatMoney(r.netOpenCents), checks: r.paidChecks + r.openChecks })
                            : `${dayLabel(r.date)} · ${t('chart_unread')}`;
                        return (
                            <div key={r.date} title={title} style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
                                {read ? (
                                    <>
                                        {r.netOpenCents > 0 && <div style={{ height: `${px(r.netOpenCents)}px`, background: OPEN_COLOR, borderRadius: '4px 4px 0 0', marginBottom: '2px' }} />}
                                        <div style={{ height: `${px(r.netPaidCents)}px`, background: PAID_COLOR, borderRadius: r.netOpenCents > 0 ? '0 0 4px 4px' : '4px', outline: r.date === today ? '2px solid var(--accent-secondary)' : undefined }} />
                                    </>
                                ) : (
                                    <div style={{ height: '6px', border: '1px dashed var(--text-secondary)', borderRadius: '3px', opacity: 0.6 }} />
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
            <div style={{ display: 'flex', gap: rows.length > 40 ? '2px' : '6px', padding: '0 4px', marginRight: '64px' }}>
                {rows.map((r, i) => {
                    const show = i % every === 0 || r.date === today || i === rows.length - 1;
                    return (
                        <span key={r.date} style={{ flex: '1 1 0', minWidth: 0, fontSize: '0.75rem', textAlign: 'center', color: r.date === today ? 'var(--accent-primary)' : 'var(--text-secondary)', fontWeight: r.date === today ? 700 : 400, whiteSpace: 'nowrap', overflow: 'visible' }}>
                            {show ? dayLabel(r.date, { day: 'numeric', month: rows.length > 14 ? undefined : 'short' }) : ''}
                        </span>
                    );
                })}
            </div>
        </div>
    );
}
