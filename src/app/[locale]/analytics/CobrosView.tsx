'use client';

import { type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { formatMoney } from '@/lib/money';
import { dayOfWeek, isRead, splitTender, summarizeDays, toastTotalCents, toastTotalOf, serviceChargeCents } from '@/lib/analytics/daily';
import type { DateRange } from '@/lib/analytics/range';
import { analyticsHref } from '@/lib/analyticsView';
import { DayBars, Tile, daySeries, useAnalyticsDaily, useDateLabels, numStyle, panelStyle, PAID_COLOR, OPEN_COLOR, CASH_COLOR } from './charts';

/**
 * Analytics › Cobros: how the money came in. The same PosDailySales rows as
 * everywhere else, split by tender the one way the snapshot allows — checks
 * settled only in cash against everything else (card, split tenders, gift
 * cards) — with what is still open kept apart. A day read before the cash
 * figures existed has no split; it is shown whole and counted as missing,
 * never guessed.
 */

const headCell: CSSProperties = { padding: '0.6rem 0.75rem', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-secondary)', fontWeight: 600 };
const cell: CSSProperties = { padding: '0.6rem 0.75rem', fontSize: '0.95rem' };
const numCell: CSSProperties = { ...cell, ...numStyle, textAlign: 'right' };

const pct1 = (part: number, whole: number) => (whole > 0 ? (Math.round((part / whole) * 1000) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 }) : '0');

export default function CobrosView({ locale, range, today }: { locale: string; range: DateRange; today: string }) {
    const t = useTranslations('Analytics');
    const ts = useTranslations('Sales');
    const { data, error, loading } = useAnalyticsDaily(range);
    const { dayLabel, timeLabel } = useDateLabels(locale);

    if (error) return <p style={{ margin: 0, color: 'var(--danger)' }}>{error}</p>;
    if (!data) return <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('loading')}</p>;

    const rows = data.rows;
    const s = summarizeDays(rows);
    const latest = rows.reduce<string | null>((acc, r) => (r.computedAt && (!acc || r.computedAt > acc) ? r.computedAt : acc), null);
    const missingCash = s.days - s.cashDays;

    // Weekend here is Friday to Sunday — the nights the dining room fills.
    const isWeekend = (date: string) => [5, 6, 0].includes(dayOfWeek(date));
    let weekendCash = 0, weekdayOpen = 0, weekendOpen = 0;
    for (const r of rows) {
        if (!isRead(r)) continue;
        const split = splitTender(r);
        if (split && isWeekend(r.date)) weekendCash += split.cashNetCents;
        if (isWeekend(r.date)) weekendOpen += r.openChecks; else weekdayOpen += r.openChecks;
    }

    const history = [...rows].reverse();

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', opacity: loading ? 0.6 : 1, transition: 'opacity 0.2s' }}>
            <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                {t('showing_read', { count: s.days })}
                {s.unreadDays > 0 && <> · {t('showing_unread', { count: s.unreadDays })}</>}
                {latest && <> · {t('updated', { time: timeLabel(latest) })}</>}
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                <Tile title={t('cob_card')} value={formatMoney(s.cardNetCents)} color={PAID_COLOR}
                    sub={<>{t('cob_card_sub', { pct: pct1(s.cardNetCents, s.netPaidCents), checks: s.cardChecks })}{missingCash > 0 && <> · {t('kpi_cash_missing', { count: missingCash })}</>}</>}
                    series={daySeries(rows, r => splitTender(r)?.cardNetCents ?? r.netPaidCents)} />
                <Tile title={t('kpi_cash')} value={formatMoney(s.cashNetCents)} color={CASH_COLOR}
                    sub={t('kpi_cash_sub', { pct: pct1(s.cashNetCents, s.netPaidCents), checks: s.cashChecks })}
                    series={daySeries(rows, r => splitTender(r)?.cashNetCents ?? 0)} />
                <Tile title={t('kpi_open')} value={formatMoney(s.netOpenCents)} color={OPEN_COLOR} tone={s.netOpenCents > 0 ? 'warn' : undefined}
                    sub={s.openChecks > 0 ? t('kpi_open_sub', { checks: s.openChecks, days: s.openDays.length }) : t('kpi_open_none')}
                    series={daySeries(rows, r => r.netOpenCents)} />
                <Tile title={t('kpi_surcharge')} value={formatMoney(s.surchargeCents)} color="var(--text-secondary)"
                    sub={t('cob_surcharge_sub', { pct: pct1(s.surchargeCents, s.cardNetCents) })} />
                <Tile title={t('kpi_service')} value={formatMoney(s.serviceChargeCents)} color="var(--text-secondary)"
                    sub={t('cob_service_sub', { gratuity: formatMoney(s.gratuityCents), other: formatMoney(s.otherChargeCents) })} />
            </div>

            <DayBars title={t('cob_chart_title')} rows={rows} today={today} dayLabel={dayLabel}
                series={[
                    { label: t('cob_card'), color: PAID_COLOR, value: r => splitTender(r)?.cardNetCents ?? r.netPaidCents },
                    { label: t('kpi_cash'), color: CASH_COLOR, value: r => splitTender(r)?.cashNetCents ?? 0 },
                    { label: t('legend_open'), color: OPEN_COLOR, value: r => r.netOpenCents }
                ]}
                tip={r => {
                    const split = splitTender(r);
                    return split
                        ? t('cob_tip', { day: dayLabel(r.date), card: formatMoney(split.cardNetCents), cash: formatMoney(split.cashNetCents), open: formatMoney(r.netOpenCents) })
                        : t('cob_tip_nocash', { day: dayLabel(r.date), paid: formatMoney(r.netPaidCents), open: formatMoney(r.netOpenCents) });
                }} />

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1rem', alignItems: 'start' }}>
                <div className="glass-panel" style={panelStyle}>
                    <h2 style={{ margin: 0, fontSize: '1.2rem' }}>{t('cob_patterns_title')}</h2>
                    {s.days < 7 ? (
                        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('cob_pattern_none')}</p>
                    ) : (
                        <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.4rem', fontSize: '0.95rem' }}>
                            {s.cashNetCents > 0 && <li>{t('cob_pattern_weekend', { pct: pct1(weekendCash, s.cashNetCents) })}</li>}
                            {s.openChecks > 0 && <li>{t('cob_pattern_open', { weekday: weekdayOpen, weekend: weekendOpen })}</li>}
                            <li>{t('cob_pattern_card', { pct: pct1(s.cardNetCents, s.netPaidCents) })}</li>
                        </ul>
                    )}
                    {missingCash > 0 && (
                        <span style={{ fontSize: '0.9rem' }}>
                            {t('kpi_cash_missing', { count: missingCash })} · <Link href={analyticsHref(locale, 'ventas')} style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{t('alert_unread_link')}</Link>
                        </span>
                    )}
                </div>

                <div className="glass-panel" style={{ ...panelStyle, borderTop: `3px solid ${s.openChecks > 0 ? OPEN_COLOR : 'var(--success)'}` }}>
                    <h2 style={{ margin: 0, fontSize: '1.2rem' }}>{t('alert_open_title')}{s.openChecks > 0 && <> · {formatMoney(s.netOpenCents)}</>}</h2>
                    {s.openChecks === 0 ? (
                        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('kpi_open_none')}</p>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                            {s.openDays.map(d => (
                                <span key={d.date} style={{ ...numStyle, fontSize: '0.95rem' }}>{t('alert_open_line', { day: dayLabel(d.date), checks: d.openChecks, amount: formatMoney(d.netOpenCents) })}</span>
                            ))}
                            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('alert_open_hint')}</span>
                        </div>
                    )}
                </div>
            </div>

            <div className="glass-panel" style={{ padding: '0.5rem 0', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '820px' }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                            <th style={{ ...headCell, textAlign: 'left' }}>{ts('th_day')}</th>
                            <th style={{ ...headCell, textAlign: 'right' }}>{t('cob_card')}</th>
                            <th style={{ ...headCell, textAlign: 'right' }}>{ts('th_cash')}</th>
                            <th style={{ ...headCell, textAlign: 'right' }}>{ts('th_open')}</th>
                            <th style={{ ...headCell, textAlign: 'right' }}>{ts('th_surcharge')}</th>
                            <th style={{ ...headCell, textAlign: 'right' }}>{ts('th_service')}</th>
                            <th style={{ ...headCell, textAlign: 'right' }}>{ts('th_total')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {history.map(r => {
                            const read = isRead(r);
                            const split = splitTender(r);
                            const isToday = r.date === today;
                            return (
                                <tr key={r.date} style={{ borderBottom: '1px solid var(--border)', color: read ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                                    <td style={{ ...cell, fontWeight: isToday ? 700 : 500, whiteSpace: 'nowrap', color: isToday ? 'var(--accent-primary)' : undefined }}>{dayLabel(r.date)}{isToday ? ` · ${ts('today_suffix')}` : ''}</td>
                                    <td style={{ ...numCell, fontWeight: 600 }}>{!read ? '—' : split ? <>{formatMoney(split.cardNetCents)} <Count n={split.cardChecks} /></> : <>{formatMoney(r.netPaidCents)} <Count n={r.paidChecks} /></>}</td>
                                    <td style={numCell}>{split ? <>{formatMoney(split.cashNetCents)} <Count n={split.cashChecks} /></> : '—'}</td>
                                    <td style={{ ...numCell, color: read && r.netOpenCents > 0 ? OPEN_COLOR : undefined }}>{read ? <>{formatMoney(r.netOpenCents)} <Count n={r.openChecks} /></> : '—'}</td>
                                    <td style={numCell}>{read ? formatMoney(r.surchargeCents) : '—'}</td>
                                    <td style={numCell}>{read ? formatMoney(serviceChargeCents(r)) : '—'}</td>
                                    <td style={numCell}>{read ? formatMoney(toastTotalCents(r)) : '—'}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                    {s.days > 0 && (
                        <tfoot>
                            <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                                <td style={{ ...cell, whiteSpace: 'nowrap' }}>{ts('row_total', { days: s.days })}</td>
                                <td style={numCell}>{formatMoney(s.cardNetCents)} <Count n={s.cardChecks} /></td>
                                <td style={numCell}>{formatMoney(s.cashNetCents)} <Count n={s.cashChecks} /></td>
                                <td style={{ ...numCell, color: s.netOpenCents > 0 ? OPEN_COLOR : undefined }}>{formatMoney(s.netOpenCents)} <Count n={s.openChecks} /></td>
                                <td style={numCell}>{formatMoney(s.surchargeCents)}</td>
                                <td style={numCell}>{formatMoney(s.serviceChargeCents)}</td>
                                <td style={numCell}>{formatMoney(toastTotalOf(s))}</td>
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>

            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('cob_footnote')}</p>
        </div>
    );
}

/** "· 12" after an amount: how many checks it covers. */
function Count({ n }: { n: number }) {
    return <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 400 }}>· {n}</span>;
}
