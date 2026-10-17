'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { RefreshCw } from 'lucide-react';
import { formatMoney } from '@/lib/money';
import { getHoyOverview, type HoyResult } from '@/app/actions/hoy';
import { Bars, Card, Delta, PhoneHeader, Row, Section, Stat, num, page } from '@/components/phone/ui';

/**
 * Hoy — the Admin app's home on a phone. Everything is paid-only ("ventas
 * netas"), the way Analytics counts it; open tables sit in their own amber
 * tile. Figures refresh when the auto-sync on open writes new rows
 * (fusionista:synced) and on every foreground.
 */
export default function HoyView({ locale }: { locale: 'es' | 'en' }) {
    const t = useTranslations('Phone');
    const [data, setData] = useState<HoyResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [tick, setTick] = useState(0);

    useEffect(() => {
        let alive = true;
        getHoyOverview().then(r => { if (!alive) return; if (r.success) { setData(r); setError(null); } else setError(r.code === 'NOT_ADMIN' ? t('adminOnly') : t('loadFailed')); })
            .catch(() => alive && setError(t('loadFailed')));
        return () => { alive = false; };
    }, [tick, t]);

    useEffect(() => {
        const bump = () => setTick(n => n + 1);
        const onVisible = () => { if (document.visibilityState === 'visible') bump(); };
        window.addEventListener('fusionista:synced', bump);
        document.addEventListener('visibilitychange', onVisible);
        return () => { window.removeEventListener('fusionista:synced', bump); document.removeEventListener('visibilitychange', onVisible); };
    }, []);

    const dateFmt = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' }), [locale]);
    const timeFmt = useMemo(() => new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }), [locale]);
    const shortDate = useMemo(() => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'America/New_York' }), [locale]);
    const display = (o: { name: string; nameEs: string | null }) => (locale === 'es' && o.nameEs ? o.nameEs : o.name);

    const row = data?.row ?? null;
    const lastWeek = data?.lastWeek ?? null;
    const nowHour = data?.nowHour ?? 23;

    // Hourly series: 10 AM to 2 AM (business day runs to 4 AM) — the hours a restaurant lives in.
    const HOURS = useMemo(() => [...Array.from({ length: 14 }, (_, i) => 10 + i), 0, 1, 2], []);
    const hourly = (r: DailySalesRow | null, upTo?: number) => HOURS.map(h => {
        if (!r || r.hourlyNetCents.length < 24) return 0;
        if (upTo !== undefined) {
            // "a esta hora": only the buckets that have already happened today (business-day order)
            const idx = HOURS.indexOf(h), nowIdx = HOURS.indexOf(nowHour);
            if (nowIdx >= 0 && idx > nowIdx) return 0;
        }
        return r.hourlyNetCents[h] ?? 0;
    });
    const todaySeries = hourly(row);
    const lastWeekSeries = hourly(lastWeek);
    const lastWeekSoFar = hourly(lastWeek, nowHour).reduce((a, b) => a + b, 0);
    const hasHourly = !!row && row.hourlyNetCents.length === 24 && todaySeries.some(v => v > 0);
    const labels = HOURS.map(h => (h % 3 === 1 || h === 10 ? (h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`) : null));

    const net = row?.netPaidCents ?? 0;
    const delta = lastWeek && lastWeekSoFar > 0 ? ((net - lastWeekSoFar) / lastWeekSoFar) * 100 : lastWeek && lastWeek.netPaidCents > 0 && !hasHourly ? ((net - lastWeek.netPaidCents) / lastWeek.netPaidCents) * 100 : null;
    const ticket = row && row.paidChecks > 0 ? net / row.paidChecks : null;
    const service = (row?.gratuityCents ?? 0) + (row?.otherChargeCents ?? 0);
    const cash = row?.cashNetCents ?? 0;
    const cashPct = net > 0 ? (cash / net) * 100 : 0;

    return (
        <div style={page}>
            <PhoneHeader eyebrow={data ? dateFmt.format(new Date(`${data.today}T12:00:00Z`)) : ' '} title={t('hoyTitle')}
                right={row?.computedAt ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{t('toastUpdated', { time: timeFmt.format(new Date(row.computedAt)) })}<RefreshCw size={13} /></span> : null} />

            {error && <Card><span style={{ color: 'var(--danger)' }}>{error}</span></Card>}
            {!data && !error && <Card><span style={{ color: 'var(--text-secondary)' }}>{t('loading')}</span></Card>}

            {data && (<>
                <Card>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{t('netToday')}</div>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap', marginTop: 2 }}>
                        <div style={{ fontSize: '2.4rem', fontWeight: 700, lineHeight: 1, letterSpacing: '-0.02em' }}>{formatMoney(net)}</div>
                        <Delta pct={delta} label={hasHourly ? t('vsLastWeekNow') : t('vsLastWeek')} />
                    </div>
                    {hasHourly ? (
                        <div style={{ marginTop: '0.75rem' }}>
                            <Bars values={todaySeries} ghost={lastWeekSeries} labels={labels} height={64} />
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-secondary)', marginTop: 4, gap: 8 }}>
                                <span>{t('byHour')}</span>
                                {lastWeek && <span>{t('lastWeekNow', { amount: formatMoney(lastWeekSoFar) })}</span>}
                            </div>
                        </div>
                    ) : (
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>{row ? t('noHourlyYet') : t('noSalesYet')}</div>
                    )}
                </Card>

                <div style={{ display: 'flex', gap: '0.6rem' }}>
                    <Stat label={t('checks')} value={num(row?.paidChecks ?? 0)} sub={ticket !== null ? t('avgTicket', { amount: formatMoney(Math.round(ticket)) }) : t('noChecks')} />
                    <Stat label={t('service')} value={formatMoney(service)} sub={net > 0 ? t('pctOfNet', { pct: num((service / net) * 100, 1) }) : ' '} />
                </div>
                <div style={{ display: 'flex', gap: '0.6rem' }}>
                    <Stat label={t('cash')} value={formatMoney(cash)} sub={t('cashSub', { pct: num(cashPct), checks: row?.cashChecks ?? 0 })} />
                    <Stat label={t('open')} value={formatMoney(row?.netOpenCents ?? 0)} tone={(row?.openChecks ?? 0) > 0 ? 'warn' : undefined}
                        sub={(row?.openChecks ?? 0) > 0 ? t('openSub', { count: row!.openChecks }) : t('openNone')} />
                </div>

                <Card>
                    <Section title={t('topToday')} />
                    <div style={{ marginTop: 4 }}>
                        {data.top.length === 0 && <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', padding: '0.5rem 0' }}>{t('noItemsYet')}</div>}
                        {data.top.map((it, i) => (
                            <Row key={it.name} title={it.name} sub={t('sold', { count: num(it.qty) })} right={formatMoney(it.cents)} last={i === data.top.length - 1} />
                        ))}
                    </div>
                </Card>

                <Card>
                    <Section title={t('pending')} />
                    <div style={{ marginTop: 4 }}>
                        <Row href={`/${locale}/compras`} title={t('comprasPending', { count: data.pending.comprasPorPedir })}
                            sub={data.pending.comprasByProvider.slice(0, 3).map(p => `${p.provider} ${p.count}`).join(' · ') || t('comprasNone')} />
                        {data.pending.repuestosAbiertos.map(s => (
                            <Row key={s.name} href={`/${locale}/inventory`} title={t('spareOpened', { name: display(s) })} sub={t('spareOpenedSub', { date: shortDate.format(new Date(s.openedAt)) })} />
                        ))}
                        {data.pending.limpiezasFaltante.map((c, i) => (
                            <Row key={c.date} href={`/${locale}/inventory`} title={t('cleaningMissing', { date: shortDate.format(new Date(c.date)) })} sub={t('cleaningMissingSub', { lb: num(c.unaccountedLb, 1), cooks: c.cooks ?? '—', raw: display({ name: c.raw, nameEs: c.rawEs }) })}
                                last={i === data.pending.limpiezasFaltante.length - 1} />
                        ))}
                        {data.pending.repuestosAbiertos.length === 0 && data.pending.limpiezasFaltante.length === 0 && (
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', padding: '0.5rem 0 0.2rem' }}>{t('pendingNone')}</div>
                        )}
                    </div>
                </Card>
            </>)}
        </div>
    );
}

type DailySalesRow = NonNullable<HoyResult['row']>;
