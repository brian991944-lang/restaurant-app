'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { formatMoney } from '@/lib/money';
import type { DowAverage } from '@/lib/analytics/daily';
import { forecastDays, isRead, summarizeDays, deltaPct, weekdayAverages } from '@/lib/analytics/daily';
import type { DateRange } from '@/lib/analytics/range';
import { analyticsHref } from '@/lib/analyticsView';
import { DayBars, Tile, daySeries, pctText, useAnalyticsDaily, useDateLabels, numStyle, panelStyle, PAID_COLOR, OPEN_COLOR, CASH_COLOR, GRID_COLOR } from './charts';

/**
 * Analytics › Resumen: the window's money at a glance. Every figure comes
 * from the same PosDailySales rows the Ventas table shows, reduced by
 * src/lib/analytics/daily.ts — nothing here is estimated except the forecast,
 * which says so. Open is never added to paid anywhere on this page.
 */
export default function ResumenView({ locale, range, today, refreshKey = 0 }: { locale: string; range: DateRange; today: string; refreshKey?: number }) {
    const t = useTranslations('Analytics');
    const { data, error, loading } = useAnalyticsDaily(range, refreshKey);
    const { dayLabel, weekdayName, timeLabel } = useDateLabels(locale);

    if (error) return <p style={{ margin: 0, color: 'var(--danger)' }}>{error}</p>;
    if (!data) return <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('loading')}</p>;

    const rows = data.rows;
    const s = summarizeDays(rows);
    // Compared only against a previous window that was read in full.
    const prev = data.previous && data.previous.rows.every(isRead) ? summarizeDays(data.previous.rows) : null;
    const delta = (current: number, previous: number | null | undefined) => {
        const pct = prev ? deltaPct(current, previous) : null;
        if (pct === null) return <span style={{ color: 'var(--text-secondary)' }}>{t('delta_na')}</span>;
        return <span style={{ color: pct >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>{pctText(pct)} <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>{t('delta_vs')}</span></span>;
    };
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
                    delta={delta(s.netPaidCents, prev?.netPaidCents)} series={daySeries(rows, r => r.netPaidCents)} />
                <Tile title={t('kpi_ticket')} value={s.avgTicketCents !== null ? formatMoney(s.avgTicketCents) : '—'} color={PAID_COLOR}
                    sub={t('kpi_ticket_sub', { checks: s.paidChecks })}
                    delta={s.avgTicketCents !== null ? delta(s.avgTicketCents, prev?.avgTicketCents) : undefined} series={daySeries(rows, r => r.paidChecks)} />
                <Tile title={t('kpi_open')} value={formatMoney(s.netOpenCents)} color={OPEN_COLOR} tone={s.netOpenCents > 0 ? 'warn' : undefined}
                    sub={s.openChecks > 0 ? t('kpi_open_sub', { checks: s.openChecks, days: s.openDays.length }) : t('kpi_open_none')}
                    series={daySeries(rows, r => r.netOpenCents)} />
                <Tile title={t('kpi_cash')} value={formatMoney(s.cashNetCents)} color={CASH_COLOR}
                    sub={<>{t('kpi_cash_sub', { pct: cashPct.toLocaleString('en-US', { maximumFractionDigits: 1 }), checks: s.cashChecks })}{s.cashDays < s.days && <> · {t('kpi_cash_missing', { count: s.days - s.cashDays })}</>}</>}
                    delta={delta(s.cashNetCents, prev?.cashNetCents)} />
                <Tile title={t('kpi_surcharge')} value={formatMoney(s.surchargeCents)} color="var(--text-secondary)" sub={t('kpi_apart')}
                    delta={delta(s.surchargeCents, prev?.surchargeCents)} />
                <Tile title={t('kpi_service')} value={formatMoney(s.serviceChargeCents)} color="var(--text-secondary)" sub={t('kpi_apart')}
                    delta={delta(s.serviceChargeCents, prev?.serviceChargeCents)} />
            </div>

            <DayBars title={t('chart_title')} rows={rows} today={today} dayLabel={dayLabel} read={isRead}
                series={[{ label: t('legend_paid'), color: PAID_COLOR, value: r => r.netPaidCents }, { label: t('legend_open'), color: OPEN_COLOR, value: r => r.netOpenCents }]}
                avg={s.avgNetPerDayCents !== null ? { cents: s.avgNetPerDayCents, label: t('legend_avg', { amount: formatMoney(s.avgNetPerDayCents) }) } : null}
                tip={r => t('chart_tip', { day: dayLabel(r.date), paid: formatMoney(r.netPaidCents), open: formatMoney(r.netOpenCents), checks: r.paidChecks + r.openChecks })} />

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem', alignItems: 'start' }}>
                <div className="glass-panel" style={panelStyle}>
                    <div>
                        <h2 style={{ margin: 0, fontSize: '1.2rem' }}>{t('dow_title')}</h2>
                        <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('dow_sub')}</p>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                        {dowOrder.map(dow => <WeekdayRow key={dow} d={weekdays[dow]} name={weekdayName(dow)} max={dowMax} t={t} />)}
                    </div>
                </div>

                <div className="glass-panel" style={{ ...panelStyle, borderTop: `3px solid ${s.openChecks > 0 || s.unreadDays > 0 ? OPEN_COLOR : 'var(--success)'}` }}>
                    <h2 style={{ margin: 0, fontSize: '1.2rem' }}>{t('alerts_title')}</h2>
                    {s.openChecks === 0 && s.unreadDays === 0 ? (
                        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('alert_none')}</p>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            {s.openChecks > 0 && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                    <span style={{ fontWeight: 600, color: OPEN_COLOR }}>{t('alert_open_title')} · {formatMoney(s.netOpenCents)}</span>
                                    {s.openDays.slice(0, 8).map(d => (
                                        <span key={d.date} style={{ ...numStyle, fontSize: '0.9rem' }}>{t('alert_open_line', { day: dayLabel(d.date), checks: d.openChecks, amount: formatMoney(d.netOpenCents) })}</span>
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

                <div className="glass-panel" style={panelStyle}>
                    <div>
                        <h2 style={{ margin: 0, fontSize: '1.2rem' }}>{t('forecast_title')}</h2>
                        <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('forecast_sub')}</p>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                        {forecast.days.map(d => (
                            <div key={d.date} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', fontSize: '0.95rem' }}>
                                <span>{dayLabel(d.date)}</span>
                                <span style={{ ...numStyle, fontWeight: 600, color: d.expectedCents === null ? 'var(--text-secondary)' : undefined }}>
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
            <span style={{ ...numStyle, textAlign: 'right' }}>
                {d.avgNetCents === null ? <span style={{ color: 'var(--text-secondary)' }}>{t('dow_none')}</span> : <strong>{formatMoney(d.avgNetCents)}</strong>}
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}> · {t('dow_days', { count: d.days })}</span>
            </span>
        </div>
    );
}
