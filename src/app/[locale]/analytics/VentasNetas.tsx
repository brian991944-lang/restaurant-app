'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { RefreshCw } from 'lucide-react';
import { formatMoney } from '@/lib/money';
import { refreshToastDailySales } from '@/app/actions/toastDailySales';
import { getAnalyticsDaily } from '@/app/actions/analytics';
import type { DailySalesReport, DailySalesRow, SalesErrorCode } from '@/lib/pos/toastDailySales';
import type { DateRange } from '@/lib/analytics/range';
import { summarizeDays, toastTotalOf } from '@/lib/analytics/daily';

/**
 * Ventas netas (Toast): the day's money with the Clover-style distinction
 * Toast's own reports do not make — only paid or closed checks count as net
 * sales; open checks are shown beside them, never added in. Surcharges and
 * service charges are their own cards, not part of net sales.
 *
 * Reads PosDailySales (written by the refresh button and the nightly cron);
 * nothing here calls Toast directly. The cards are always today; the table
 * is the window the Analytics shell hands down, with its totals. Every
 * string comes from the Sales namespace, and dates follow the reader's
 * language.
 */

const PAID_COLOR = 'var(--accent-primary)';
const OPEN_COLOR = '#c98500'; // the Dashboard's amber, for "not yet in the register"
const NEUTRAL_COLOR = 'var(--text-secondary)';

/** Toast's own net sales: it counts open checks and non-gratuity service charges. */
const toastTotal = (r: DailySalesRow) => r.netPaidCents + r.netOpenCents + r.surchargeCents + r.otherChargeCents;
const serviceCharges = (r: DailySalesRow) => r.gratuityCents + r.otherChargeCents;
/** Never read, or read before the cash figures existed — either way a read fills it in. */
const needsRead = (r: DailySalesRow) => r.computedAt === null || r.cashChecks === null;

const numeric: CSSProperties = { textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const headCell: CSSProperties = { padding: '0.6rem 0.75rem', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-secondary)', fontWeight: 600 };
const cell: CSSProperties = { padding: '0.6rem 0.75rem', fontSize: '0.95rem' };

function Card({ label, value, sub, color, big }: { label: string; value: string; sub?: string; color: string; big?: boolean }) {
    return (
        <div className="glass-panel" style={{ padding: '1.1rem 1.4rem', display: 'flex', flexDirection: 'column', gap: '0.3rem', borderTop: `3px solid ${color}` }}>
            <span style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-secondary)', fontWeight: 600 }}>{label}</span>
            <span style={{ fontSize: big ? '2.2rem' : '1.6rem', fontWeight: 700, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>{value}</span>
            {sub && <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{sub}</span>}
        </div>
    );
}

export default function VentasNetas({ range }: { range: DateRange }) {
    const t = useTranslations('Sales');
    const locale = useLocale();

    /** 'Fri, Oct 9' / 'vie, 9 oct' for a 'YYYY-MM-DD' Toast business date. */
    const dayLabel = (date: string) =>
        new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
            .format(new Date(`${date}T12:00:00Z`));
    const timeLabel = (iso: string) =>
        new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' }).format(new Date(iso));

    /** The server answers in codes; the words are the reader's. */
    const errorText = (code: SalesErrorCode | undefined, fallback: string) => {
        switch (code) {
            case 'NOT_ADMIN': return t('err_admin');
            case 'BAD_DATE': return t('err_bad_date');
            case 'FAILED': return t('err_failed');
            case 'READ_FAILED': return t('err_read_failed');
            default: return fallback;
        }
    };
    const skippedText = (r: DailySalesReport) => {
        switch (r.skippedCode) {
            case 'BAD_DATE': return t('skip_bad_date');
            case 'TRUNCATED': return t('skip_truncated');
            case 'TOAST_ENV': return t('skip_toast_env');
            case 'TOAST_HTTP': return t('skip_toast_http', { status: r.skippedStatus ?? 0 });
            case 'TOAST_FAILED': return t('skip_toast_failed');
            default: return r.skipped ?? '';
        }
    };

    const [rows, setRows] = useState<DailySalesRow[]>([]);
    const [today, setToday] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    /** "3 of 12 · Tue, Sep 29" while a backfill runs; null otherwise. */
    const [backfill, setBackfill] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const load = useCallback(async (): Promise<DailySalesRow[]> => {
        try {
            const res = await getAnalyticsDaily(range.from, range.to);
            if (res.success) {
                setRows(res.rows);
                setToday(res.today);
                setError(null);
                return res.rows;
            }
            setError(errorText(res.code, t('err_read_failed')));
        } catch {
            // A rejected action (deploy mid-flight, network) must not leave the
            // panel on "Loading…" forever.
            setError(t('err_rejected'));
        } finally {
            setLoading(false);
        }
        return [];
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [locale, range.from, range.to]);

    useEffect(() => { load(); }, [load]);

    const busy = refreshing || backfill !== null;

    /** Read every day that needs it, oldest first, one request per day. */
    const handleBackfill = async () => {
        const missing = rows.filter(needsRead).map(r => r.date);
        if (missing.length === 0) return;
        setNotice(null);
        setError(null);
        const skipped: string[] = [];
        try {
            for (let i = 0; i < missing.length; i++) {
                const date = missing[i];
                setBackfill(t('backfill_progress', { i: i + 1, n: missing.length, day: dayLabel(date) }));
                const res = await refreshToastDailySales(date);
                if (!res.success) {
                    setError(t('err_backfill_stopped', { day: dayLabel(date), reason: errorText(res.code, t('err_failed')) }));
                    return;
                }
                for (const r of res.reports ?? []) if (r.skipped) skipped.push(`${dayLabel(r.date)}: ${skippedText(r)}`);
                await load(); // the row fills in as the loop goes
            }
            if (skipped.length) setNotice(skipped.join(' · '));
        } catch {
            setError(t('err_backfill_interrupted'));
        } finally {
            setBackfill(null);
        }
    };

    const handleRefresh = async () => {
        setRefreshing(true);
        setNotice(null);
        try {
            const res = await refreshToastDailySales();
            if (!res.success) {
                setError(errorText(res.code, t('err_failed')));
                return;
            }
            const skipped = (res.reports ?? []).filter(r => r.skipped);
            if (skipped.length) setNotice(skipped.map(r => `${dayLabel(r.date)}: ${skippedText(r)}`).join(' · '));
            await load();
        } catch {
            setError(t('err_refresh_rejected'));
        } finally {
            setRefreshing(false);
        }
    };

    const todayRow = rows.find(r => r.date === today) ?? null;
    const hasToday = !!todayRow?.computedAt;
    const money = (cents: number | undefined) => (hasToday && cents !== undefined ? formatMoney(cents) : '—');
    const history = [...rows].reverse(); // newest first
    const maxTotal = Math.max(0, ...rows.map(toastTotal));
    const missingCount = rows.filter(needsRead).length;
    const totals = summarizeDays(rows);
    /** Net sales per paid check for one day; null without a paid check. */
    const ticket = (r: DailySalesRow) => (r.paidChecks > 0 ? Math.round(r.netPaidCents / r.paidChecks) : null);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                <div>
                    <h2 style={{ fontSize: '1.75rem', margin: 0 }}>{t('net_title')}</h2>
                    <p style={{ color: 'var(--text-secondary)', margin: '0.25rem 0 0 0' }}>{t('net_subtitle')}</p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.4rem' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        {/* Only while history is incomplete: reads the missing days one by one. */}
                        {!loading && missingCount > 0 && (
                            <button
                                onClick={handleBackfill}
                                disabled={busy}
                                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderRadius: '8px', padding: '0.6rem 1.25rem', minHeight: '44px', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-primary)', cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1 }}
                            >
                                <RefreshCw size={18} className={backfill ? 'vn-spin' : ''} />
                                {backfill ?? t('backfill', { count: missingCount })}
                            </button>
                        )}
                        <button
                            onClick={handleRefresh}
                            disabled={busy}
                            className="btn-primary"
                            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderRadius: '8px', padding: '0.6rem 1.5rem', minHeight: '44px' }}
                        >
                            <RefreshCw size={18} className={refreshing ? 'vn-spin' : ''} />
                            {refreshing ? t('refreshing') : t('refresh')}
                        </button>
                    </div>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        {hasToday && todayRow?.computedAt
                            ? t('status_today', { day: dayLabel(todayRow.date), time: timeLabel(todayRow.computedAt) })
                            : loading ? t('status_loading') : t('status_unread')}
                    </span>
                </div>
            </div>

            {error && <p style={{ margin: 0, color: 'var(--danger)' }}>{error}</p>}
            {notice && <p style={{ margin: 0, color: 'var(--warning)' }}>{notice}</p>}

            {/* Today: the three figures that matter, then what is not a sale. */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                <Card big label={t('card_net')} value={money(todayRow?.netPaidCents)} color={PAID_COLOR}
                    sub={hasToday
                        ? t('card_net_sub', { paid: todayRow!.paidChecks, cash: formatMoney(todayRow!.cashNetCents ?? 0), cashChecks: todayRow!.cashChecks ?? 0 })
                        : undefined} />
                <Card big label={t('card_open')} value={money(todayRow?.netOpenCents)} color={OPEN_COLOR}
                    sub={hasToday ? t('card_open_sub', { open: todayRow!.openChecks }) : undefined} />
                <Card big label={t('card_total')} value={money(todayRow ? toastTotal(todayRow) : undefined)} color={NEUTRAL_COLOR}
                    sub={t('card_total_sub')} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                <Card label={t('card_surcharge')} value={money(todayRow?.surchargeCents)} color={NEUTRAL_COLOR}
                    sub={t('card_apart')} />
                <Card label={t('card_service')} value={money(todayRow ? serviceCharges(todayRow) : undefined)} color={NEUTRAL_COLOR}
                    sub={hasToday ? t('card_service_sub', { gratuity: formatMoney(todayRow!.gratuityCents) }) : t('card_apart')} />
            </div>

            {/* Every day since Toast started (last 60 at most), newest first. */}
            <div className="glass-panel" style={{ padding: '0.5rem 0', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '880px' }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                            <th style={{ ...headCell, textAlign: 'left' }}>{t('th_day')}</th>
                            <th style={{ ...headCell, textAlign: 'left', minWidth: '180px' }}>{t('th_bar')}</th>
                            <th style={{ ...headCell, ...numeric }}>{t('th_net')}</th>
                            <th style={{ ...headCell, ...numeric }}>{t('th_ticket')}</th>
                            <th style={{ ...headCell, ...numeric }}>{t('th_cash')}</th>
                            <th style={{ ...headCell, ...numeric }}>{t('th_open')}</th>
                            <th style={{ ...headCell, ...numeric }}>{t('th_total')}</th>
                            <th style={{ ...headCell, ...numeric }}>{t('th_surcharge')}</th>
                            <th style={{ ...headCell, ...numeric }}>{t('th_service')}</th>
                            <th style={{ ...headCell, ...numeric }}>{t('th_checks')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {history.map(r => {
                            const isToday = r.date === today;
                            const total = toastTotal(r);
                            const paidPct = maxTotal > 0 ? (Math.max(r.netPaidCents, 0) / maxTotal) * 100 : 0;
                            const openPct = maxTotal > 0 ? (Math.max(r.netOpenCents, 0) / maxTotal) * 100 : 0;
                            return (
                                <tr key={r.date} style={{ borderBottom: '1px solid var(--border)', color: r.computedAt ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                                    <td style={{ ...cell, fontWeight: isToday ? 700 : 500, whiteSpace: 'nowrap', color: isToday ? 'var(--accent-primary)' : undefined }}>
                                        {dayLabel(r.date)}{isToday ? ` · ${t('today_suffix')}` : ''}
                                    </td>
                                    <td style={cell}>
                                        {!needsRead(r) ? (
                                            <div style={{ display: 'flex', height: '14px', borderRadius: '4px', overflow: 'hidden', background: 'rgba(127,127,127,0.12)' }}>
                                                <div style={{ width: `${paidPct}%`, background: PAID_COLOR }} />
                                                <div style={{ width: `${openPct}%`, background: OPEN_COLOR }} />
                                            </div>
                                        ) : <span style={{ fontSize: '0.85rem', fontStyle: 'italic' }}>{r.computedAt ? t('reread') : t('unread')}</span>}
                                    </td>
                                    <td style={{ ...cell, ...numeric, fontWeight: 600 }}>{r.computedAt ? formatMoney(r.netPaidCents) : '—'}</td>
                                    <td style={{ ...cell, ...numeric, color: 'var(--text-secondary)' }}>{r.computedAt && ticket(r) !== null ? formatMoney(ticket(r)!) : '—'}</td>
                                    <td style={{ ...cell, ...numeric }} title={t('cash_title')}>
                                        {r.cashChecks === null || r.cashNetCents === null
                                            ? '—'
                                            : <>{formatMoney(r.cashNetCents)} <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>· {r.cashChecks}</span></>}
                                    </td>
                                    <td style={{ ...cell, ...numeric, color: r.computedAt && r.netOpenCents > 0 ? OPEN_COLOR : undefined }}>{r.computedAt ? formatMoney(r.netOpenCents) : '—'}</td>
                                    <td style={{ ...cell, ...numeric }}>{r.computedAt ? formatMoney(total) : '—'}</td>
                                    <td style={{ ...cell, ...numeric }}>{r.computedAt ? formatMoney(r.surchargeCents) : '—'}</td>
                                    <td style={{ ...cell, ...numeric }}>{r.computedAt ? formatMoney(serviceCharges(r)) : '—'}</td>
                                    <td style={{ ...cell, ...numeric, color: 'var(--text-secondary)' }}>{r.computedAt ? `${r.paidChecks} / ${r.openChecks}` : '—'}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                    {/* The window's totals, over its read days only; a day never read adds nothing. */}
                    {totals.days > 0 && (
                        <tfoot>
                            <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                                <td style={{ ...cell, whiteSpace: 'nowrap' }}>{t('row_total', { days: totals.days })}</td>
                                <td style={cell}></td>
                                <td style={{ ...cell, ...numeric }}>{formatMoney(totals.netPaidCents)}</td>
                                <td style={{ ...cell, ...numeric, color: 'var(--text-secondary)' }}>{totals.avgTicketCents !== null ? formatMoney(totals.avgTicketCents) : '—'}</td>
                                <td style={{ ...cell, ...numeric }}>{formatMoney(totals.cashNetCents)} <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', fontWeight: 400 }}>· {totals.cashChecks}</span></td>
                                <td style={{ ...cell, ...numeric, color: totals.netOpenCents > 0 ? OPEN_COLOR : undefined }}>{formatMoney(totals.netOpenCents)}</td>
                                <td style={{ ...cell, ...numeric }}>{formatMoney(toastTotalOf(totals))}</td>
                                <td style={{ ...cell, ...numeric }}>{formatMoney(totals.surchargeCents)}</td>
                                <td style={{ ...cell, ...numeric }}>{formatMoney(totals.serviceChargeCents)}</td>
                                <td style={{ ...cell, ...numeric, color: 'var(--text-secondary)' }}>{totals.paidChecks} / {totals.openChecks}</td>
                            </tr>
                        </tfoot>
                    )}
                </table>
            </div>

            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('legend')}</p>

            <style jsx>{`
                @keyframes vn-spin { 100% { transform: rotate(360deg); } }
                :global(.vn-spin) { animation: vn-spin 1s linear infinite; }
            `}</style>
        </div>
    );
}
