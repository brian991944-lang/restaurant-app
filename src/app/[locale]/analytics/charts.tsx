'use client';

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { formatMoney } from '@/lib/money';
import { getAnalyticsDaily } from '@/app/actions/analytics';
import type { AnalyticsDailyResult } from '@/lib/analytics/daily';
import { isRead } from '@/lib/analytics/daily';
import type { DateRange } from '@/lib/analytics/range';
import type { DailySalesRow, SalesErrorCode } from '@/lib/pos/toastDailySales';

/**
 * The pieces every Analytics dashboard is built from: the daily-rows fetch,
 * KPI tiles with sparklines, and the stacked day-by-day bars. Hand-rolled
 * HTML and SVG rather than a chart library — a few hundred bars at most,
 * theme tokens for free, nothing to ship to the kitchen tablets.
 *
 * Colours: paid is the app's accent, open the Ventas table's amber, cash a
 * green stepped for both themes. The three were validated together as a
 * colour-blind-safe set; a fourth series would need re-validating.
 */

export const PAID_COLOR = 'var(--accent-primary)';
export const OPEN_COLOR = '#c98500';
export const CASH_COLOR = '#059669';
export const GRID_COLOR = 'var(--border)';

export const labelStyle: CSSProperties = { fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-secondary)', fontWeight: 600 };
export const panelStyle: CSSProperties = { padding: '1.25rem 1.4rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' };
export const numStyle: CSSProperties = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };

export const pctText = (pct: number) => `${pct > 0 ? '+' : ''}${pct.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;

/** The reader's labels for a Toast business date and for an ISO instant. */
export function useDateLabels(locale: string) {
    const dayLabel = (date: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) =>
        new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
    // 2026-03-01 is a Sunday, so dow 0..6 lands on Sunday..Saturday.
    const weekdayName = (dow: number) =>
        new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 2, 1 + dow, 12)));
    const timeLabel = (iso: string) =>
        new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' }).format(new Date(iso));
    return { dayLabel, weekdayName, timeLabel };
}

/**
 * The window's rows, refetched when the window moves. The previous data
 * stays on screen (dimmed by the caller) until the new one lands, so a
 * preset click never blanks the page.
 */
export function useAnalyticsDaily(range: DateRange): { data: AnalyticsDailyResult | null; error: string | null; loading: boolean } {
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

    return { data, error, loading };
}

export function Sparkline({ values, color }: { values: (number | null)[]; color: string }) {
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

export function Tile({ title, value, sub, color, delta, series, tone }: {
    title: string; value: string; sub?: ReactNode; color: string; delta?: ReactNode; series?: (number | null)[]; tone?: 'warn';
}) {
    return (
        <div className="glass-panel" style={{ ...panelStyle, gap: '0.35rem', borderTop: `3px solid ${color}` }}>
            <span style={labelStyle}>{title}</span>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '0.75rem' }}>
                <span style={{ ...numStyle, fontSize: '1.9rem', fontWeight: 700, lineHeight: 1.1, color: tone === 'warn' ? OPEN_COLOR : 'var(--text-primary)' }}>{value}</span>
                {series && <Sparkline values={series} color={color} />}
            </div>
            {sub && <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{sub}</span>}
            {delta && <span style={{ fontSize: '0.85rem' }}>{delta}</span>}
        </div>
    );
}

/** The per-day values of one series, read days only; an unread day is null (a gap). */
export const daySeries = (rows: DailySalesRow[], pick: (r: DailySalesRow) => number) => rows.map(r => (isRead(r) ? pick(r) : null));

export type BarSeries<T> = { label: string; color: string; value: (r: T) => number };

/**
 * Stacked bars, one per day, bottom series first, over any rows that carry a
 * date. Days the `read` predicate rejects (never read, no data) show as a
 * dashed stub rather than an empty slot, so a gap in the data looks like a
 * gap. Every bar carries the whole day in its tooltip; labels thin out on
 * long windows and today keeps its own. `format` renders the axis ticks —
 * money by default.
 */
export function DayBars<T extends { date: string }>({ title, subtitle, rows, today, series, avg, tip, dayLabel, read = () => true, format = cents => formatMoney(Math.round(cents)) }: {
    title: string;
    subtitle?: string;
    rows: T[];
    today: string;
    series: BarSeries<T>[];
    avg?: { cents: number; label: string } | null;
    tip: (r: T) => string;
    dayLabel: (date: string, opts?: Intl.DateTimeFormatOptions) => string;
    read?: (r: T) => boolean;
    format?: (value: number) => string;
}) {
    const t = useTranslations('Analytics');
    const H = 220;
    const total = (r: T) => series.reduce((sum, s) => sum + Math.max(0, s.value(r)), 0);
    const max = Math.max(1, ...rows.map(r => (read(r) ? total(r) : 0)));
    const every = Math.max(1, Math.ceil(rows.length / 14));
    const gap = rows.length > 40 ? '2px' : '6px';
    const px = (cents: number) => (Math.max(0, cents) / max) * H;
    return (
        <div className="glass-panel" style={panelStyle}>
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: '1.2rem' }}>{title}</h2>
                    {subtitle && <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{subtitle}</p>}
                </div>
                <div style={{ display: 'flex', gap: '1rem', fontSize: '0.85rem', color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
                    {series.map(s => <span key={s.label}><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: s.color, marginRight: 6 }} />{s.label}</span>)}
                    {avg && <span><i style={{ display: 'inline-block', width: 16, borderTop: '2px dashed var(--text-secondary)', marginRight: 6, verticalAlign: 'middle' }} />{avg.label}</span>}
                </div>
            </div>
            <div style={{ position: 'relative', height: `${H}px`, marginRight: '64px', borderBottom: `1px solid ${GRID_COLOR}` }}>
                {[0.25, 0.5, 0.75, 1].map(f => (
                    <div key={f} style={{ position: 'absolute', left: 0, right: 0, bottom: `${f * H}px`, borderTop: `1px solid ${GRID_COLOR}`, opacity: 0.6 }}>
                        <span style={{ ...numStyle, position: 'absolute', left: '100%', paddingLeft: '8px', top: '-0.6em', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{format(max * f)}</span>
                    </div>
                ))}
                {avg && avg.cents <= max && (
                    <div style={{ position: 'absolute', left: 0, right: 0, bottom: `${px(avg.cents)}px`, borderTop: '2px dashed var(--text-secondary)', zIndex: 1 }} />
                )}
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', gap, padding: '0 4px' }}>
                    {rows.map(r => {
                        const isReadRow = read(r);
                        const stack = isReadRow ? [...series].reverse().filter(s => s.value(r) > 0) : [];
                        return (
                            <div key={r.date} title={isReadRow ? tip(r) : `${dayLabel(r.date)} · ${t('chart_unread')}`}
                                style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%', outline: r.date === today ? '2px solid var(--accent-secondary)' : undefined, outlineOffset: '2px', borderRadius: '4px' }}>
                                {isReadRow ? stack.map((s, i) => (
                                    <div key={s.label} style={{ height: `${px(s.value(r))}px`, background: s.color, marginTop: i === 0 ? 0 : '2px', borderRadius: `${i === 0 ? '4px 4px' : '0 0'} ${i === stack.length - 1 ? '4px 4px' : '0 0'}` }} />
                                )) : (
                                    <div style={{ height: '6px', border: '1px dashed var(--text-secondary)', borderRadius: '3px', opacity: 0.6 }} />
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
            <div style={{ display: 'flex', gap, padding: '0 4px', marginRight: '64px' }}>
                {rows.map((r, i) => {
                    const show = i % every === 0 || r.date === today || i === rows.length - 1;
                    return (
                        <span key={r.date} style={{ flex: '1 1 0', minWidth: 0, fontSize: '0.75rem', textAlign: 'center', color: r.date === today ? 'var(--accent-primary)' : 'var(--text-secondary)', fontWeight: r.date === today ? 700 : 400, whiteSpace: 'nowrap' }}>
                            {show ? dayLabel(r.date, rows.length > 14 ? { day: 'numeric' } : { day: 'numeric', month: 'short' }) : ''}
                        </span>
                    );
                })}
            </div>
        </div>
    );
}
