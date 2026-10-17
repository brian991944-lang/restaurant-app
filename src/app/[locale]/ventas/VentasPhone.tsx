'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { formatMoney } from '@/lib/money';
import { TOAST_FIRST_BUSINESS_DATE } from '@/lib/pos/toastBusinessDate';
import { clampRange, daysBetween, presetRange, RANGE_PRESETS, type DateRange, type RangePreset } from '@/lib/analytics/range';
import { deltaPct, isRead, summarizeDays } from '@/lib/analytics/daily';
import { useAnalyticsDaily } from '@/app/[locale]/analytics/charts';
import { Bars, Card, Delta, PhoneHeader, Pills, Row, Section, Stat, num, page } from '@/components/phone/ui';
import { getToastDailyItemsForDay } from '@/app/actions/ventasPhone';

/**
 * Ventas — the phone sales screen. Same rows and same math as Analytics
 * (paid-only net sales, open apart), laid out the way a POS app does it:
 * period pills, the window's total against the previous like-for-like window,
 * bars by day, and a tappable list of days that opens the day's dishes.
 */
export default function VentasPhone({ locale, today }: { locale: 'es' | 'en'; today: string }) {
    const t = useTranslations('Phone');
    const ta = useTranslations('Analytics');
    const [preset, setPreset] = useState<RangePreset | 'custom'>('week');
    const [range, setRange] = useState<DateRange>(() => presetRange('week', today));
    const [refreshKey, setRefreshKey] = useState(0);
    const [day, setDay] = useState<string | null>(null);
    const { data, error, loading } = useAnalyticsDaily(range, refreshKey);

    useEffect(() => {
        const bump = () => setRefreshKey(k => k + 1);
        window.addEventListener('fusionista:synced', bump);
        return () => window.removeEventListener('fusionista:synced', bump);
    }, []);

    const choose = (p: RangePreset | 'custom') => {
        setPreset(p);
        if (p !== 'custom') setRange(presetRange(p, today));
    };
    const custom = (from: string, to: string) => { const r = clampRange(from, to, today); if (r) setRange(r); };

    const dayLabel = useMemo(() => (date: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric' }) =>
        new Intl.DateTimeFormat(locale, { ...opts, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`)), [locale]);
    const timeFmt = useMemo(() => new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }), [locale]);

    const rows = data?.rows ?? [];
    const read = rows.filter(isRead);
    const s = summarizeDays(rows);
    const prev = data?.previous && data.previous.rows.every(isRead) ? summarizeDays(data.previous.rows) : null;
    const prevByOffset = (i: number) => data?.previous?.rows[i] ?? null;
    const netDelta = prev ? deltaPct(s.netPaidCents, prev.netPaidCents) : null;
    const days = daysBetween(range.from, range.to);
    const latest = rows.reduce<string | null>((acc, r) => (r.computedAt && (!acc || r.computedAt > acc) ? r.computedAt : acc), null);
    const todayIdx = rows.findIndex(r => r.date === today);
    const cashPct = s.netPaidCents > 0 ? (s.cashNetCents / s.netPaidCents) * 100 : 0;
    const deltaLabel = preset === 'today' || preset === 'yesterday' ? t('vsLastWeek') : preset === 'week' ? t('vsPrevWeek') : preset === 'month' ? t('vsPrevMonth') : t('vsPrevPeriod');

    const pills = [...RANGE_PRESETS.map(p => ({ key: p as RangePreset | 'custom', label: ta(`range_${p}`) })), { key: 'custom' as const, label: ta('range_custom') }];

    return (
        <div style={page}>
            <PhoneHeader title={t('ventasTitle')} right={latest ? t('toastUpdated', { time: timeFmt.format(new Date(latest)) }) : null} />
            <Pills items={pills} active={preset} onChange={choose} />
            {preset === 'custom' && (
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <input type="date" value={range.from} min={TOAST_FIRST_BUSINESS_DATE} max={range.to} onChange={e => custom(e.target.value, range.to)} style={dateInput} aria-label={ta('range_from')} />
                    <span style={{ color: 'var(--text-secondary)' }}>→</span>
                    <input type="date" value={range.to} min={range.from} max={today} onChange={e => custom(range.from, e.target.value)} style={dateInput} aria-label={ta('range_to')} />
                </div>
            )}
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: -4 }}>
                {days === 1 ? dayLabel(range.from, { weekday: 'long', day: 'numeric', month: 'short' }) : t('rangeShowing', { from: dayLabel(range.from, { day: 'numeric', month: 'short' }), to: dayLabel(range.to, { day: 'numeric', month: 'short' }), days })}
                {s.unreadDays > 0 && <> · {ta('showing_unread', { count: s.unreadDays })}</>}
            </div>

            {error && <Card><span style={{ color: 'var(--danger)' }}>{error}</span></Card>}
            {!data && !error && <Card><span style={{ color: 'var(--text-secondary)' }}>{t('loading')}</span></Card>}

            {data && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', opacity: loading ? 0.6 : 1, transition: 'opacity 0.2s' }}>
                    <Card>
                        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{t('netSales')}</div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap', marginTop: 2 }}>
                            <div style={{ fontSize: '2.2rem', fontWeight: 700, lineHeight: 1, letterSpacing: '-0.02em' }}>{formatMoney(s.netPaidCents)}</div>
                            <Delta pct={netDelta} label={deltaLabel} />
                        </div>
                        {rows.length > 1 && (
                            <div style={{ marginTop: '0.75rem' }}>
                                <Bars values={rows.map(r => r.netPaidCents)} labels={rows.length <= 14 ? rows.map(r => dayLabel(r.date, { weekday: 'short' })) : rows.map((r, i) => (i % Math.ceil(rows.length / 7) === 0 ? dayLabel(r.date, { day: 'numeric' }) : null))}
                                    hi={todayIdx >= 0 ? todayIdx : null} height={84} onPick={i => rows[i] && isRead(rows[i]) && setDay(rows[i].date)} />
                                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: 6 }}>
                                    {todayIdx >= 0 && <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: 'var(--accent-primary)', verticalAlign: -1 }} /> {t('legendToday')}</span>}
                                    {s.avgNetPerDayCents !== null && <span>{t('avgPerDay', { amount: formatMoney(s.avgNetPerDayCents) })}</span>}
                                </div>
                            </div>
                        )}
                    </Card>

                    <div style={{ display: 'flex', gap: '0.6rem' }}>
                        <Stat label={t('avgTicketLabel')} value={s.avgTicketCents !== null ? formatMoney(s.avgTicketCents) : '—'} sub={t('checksCount', { count: num(s.paidChecks) })} />
                        <Stat label={t('cash')} value={formatMoney(s.cashNetCents)} sub={t('pctOfNet', { pct: num(cashPct) })} />
                        <Stat label={t('open')} value={formatMoney(s.netOpenCents)} tone={s.netOpenCents > 0 ? 'warn' : undefined} sub={s.openChecks > 0 ? t('openSub', { count: s.openChecks }) : t('openNone')} />
                    </div>

                    <Card>
                        <Section title={t('byDay')} />
                        <div style={{ marginTop: 4 }}>
                            {[...rows].reverse().map((r, i, arr) => {
                                const idx = rows.indexOf(r);
                                const p = prevByOffset(idx);
                                const d = p && isRead(p) && isRead(r) ? deltaPct(r.netPaidCents, p.netPaidCents) : null;
                                return (
                                    <Row key={r.date} title={dayLabel(r.date, { weekday: 'short', day: 'numeric', month: 'short' })}
                                        sub={isRead(r) ? `${t('checksCount', { count: num(r.paidChecks) })}${r.openChecks > 0 ? ` · ${t('openSub', { count: r.openChecks })}` : ''}` : t('notReadYet')}
                                        right={isRead(r) ? formatMoney(r.netPaidCents) : '—'}
                                        rsub={d !== null ? <span style={{ color: d >= 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>{d >= 0 ? '▲' : '▼'} {Math.abs(Math.round(d))}%</span> : undefined}
                                        onClick={isRead(r) ? () => setDay(r.date) : undefined} last={i === arr.length - 1} />
                                );
                            })}
                            {read.length === 0 && <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', padding: '0.5rem 0' }}>{t('noDaysRead')}</div>}
                        </div>
                    </Card>
                </div>
            )}

            {day && <DaySheet date={day} locale={locale} row={rows.find(r => r.date === day) ?? null} onClose={() => setDay(null)} />}
        </div>
    );
}

const dateInput: React.CSSProperties = { flex: 1, minWidth: 0, minHeight: 44, padding: '0 0.5rem', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', font: 'inherit', fontSize: '0.9rem' };

/** One day's dishes (paid), from the same rows the Sync wrote. */
function DaySheet({ date, locale, row, onClose }: { date: string; locale: 'es' | 'en'; row: { netPaidCents: number; paidChecks: number; netOpenCents: number; openChecks: number; cashNetCents: number | null; gratuityCents: number; otherChargeCents: number; surchargeCents: number } | null; onClose: () => void }) {
    const t = useTranslations('Phone');
    const [items, setItems] = useState<{ name: string; qty: number; cents: number }[] | null>(null);
    const [err, setErr] = useState<string | null>(null);
    useEffect(() => {
        let alive = true;
        getToastDailyItemsForDay(date).then(r => { if (!alive) return; if (r.success) setItems(r.items); else setErr(t('loadFailed')); });
        return () => { alive = false; };
    }, [date, t]);
    const title = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
    return (
        <div onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
            <div role="dialog" aria-modal="true" style={{ width: '100%', maxWidth: 560, maxHeight: '85vh', overflowY: 'auto', background: 'var(--bg-primary)', color: 'var(--text-primary)', borderRadius: '18px 18px 0 0', padding: '1rem 1rem calc(1rem + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, textTransform: 'capitalize' }}>{title}</div>
                    <button type="button" onClick={onClose} aria-label={t('close')} style={{ width: 36, height: 36, borderRadius: 18, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontFamily: 'inherit', cursor: 'pointer' }}>✕</button>
                </div>
                {row && (
                    <div style={{ display: 'flex', gap: '0.6rem' }}>
                        <Stat label={t('netSales')} value={formatMoney(row.netPaidCents)} sub={t('checksCount', { count: num(row.paidChecks) })} />
                        <Stat label={t('service')} value={formatMoney(row.gratuityCents + row.otherChargeCents)} sub={t('surchargeSub', { amount: formatMoney(row.surchargeCents) })} />
                        <Stat label={t('cash')} value={row.cashNetCents != null ? formatMoney(row.cashNetCents) : '—'} sub={row.openChecks > 0 ? t('openSub', { count: row.openChecks }) : ' '} />
                    </div>
                )}
                <Card>
                    <Section title={t('dishesSold')} />
                    <div style={{ marginTop: 4 }}>
                        {err && <div style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{err}</div>}
                        {!items && !err && <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', padding: '0.5rem 0' }}>{t('loading')}</div>}
                        {items && items.length === 0 && <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', padding: '0.5rem 0' }}>{t('noItemsYet')}</div>}
                        {items?.map((it, i) => <Row key={it.name + i} title={it.name} sub={t('sold', { count: num(it.qty) })} right={formatMoney(it.cents)} last={i === items.length - 1} />)}
                    </div>
                </Card>
            </div>
        </div>
    );
}
