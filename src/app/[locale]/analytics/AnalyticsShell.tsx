'use client';

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { RefreshCw } from 'lucide-react';
import type { AnalyticsView } from '@/lib/analyticsView';
import { TOAST_FIRST_BUSINESS_DATE } from '@/lib/pos/toastBusinessDate';
import { clampRange, daysBetween, matchPreset, presetRange, RANGE_PRESETS, type DateRange, type RangePreset } from '@/lib/analytics/range';
import { syncAnalytics } from '@/app/actions/analytics';
import type { SyncAnalyticsResult } from '@/lib/analytics/sync';
import ResumenView from './ResumenView';
import VentasView from './VentasView';
import CobrosView from './CobrosView';
import PersonalView from './PersonalView';
import ReputacionView from './ReputacionView';

/**
 * The frame every Analytics dashboard sits in: the section eyebrow, the
 * dashboard's title, and the window control (7 days / 30 days / since Toast /
 * custom dates).
 *
 * The window is state here and nowhere else. Changing it rewrites ?from&to
 * with history.replaceState — which Next's router picks up without a server
 * round trip — and remembers it in sessionStorage, so moving between
 * dashboards through the sidebar (whose links carry no query) keeps the days
 * the reader chose.
 *
 * One Sync button refreshes every source (Toast, Google, Clover) and then
 * bumps `refreshKey`, which every dashboard's fetch hook depends on, so the
 * page redraws from the rows the sync just wrote. There are no other
 * refresh buttons anywhere under Analytics.
 */

const STORAGE_KEY = 'analytics.range';

/** Dashboards that read the window — every one so far; a future one without a window leaves itself out. */
const RANGED_VIEWS: readonly AnalyticsView[] = ['resumen', 'ventas', 'personal', 'cobros', 'reputacion'];

const readStored = (today: string): DateRange | null => {
    try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<DateRange>;
        return clampRange(parsed.from, parsed.to, today);
    } catch {
        return null;
    }
};

const writeStored = (range: DateRange) => {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(range)); } catch { /* private mode: the URL still carries it */ }
};

const writeUrl = (range: DateRange) => {
    const url = new URL(window.location.href);
    url.searchParams.set('from', range.from);
    url.searchParams.set('to', range.to);
    // Next patches replaceState and keeps its own router state alongside, as its docs show with a null state.
    window.history.replaceState(null, '', url.toString());
};

const presetButton = (on: boolean): CSSProperties => ({
    minHeight: '44px',
    padding: '0 1rem',
    border: 'none',
    borderRadius: '10px',
    background: on ? 'var(--text-primary)' : 'transparent',
    color: on ? 'var(--bg-primary)' : 'var(--text-primary)',
    fontWeight: on ? 600 : 500,
    fontSize: '0.95rem',
    cursor: 'pointer',
    whiteSpace: 'nowrap'
});

const dateInput: CSSProperties = {
    minHeight: '44px',
    padding: '0 0.6rem',
    borderRadius: '10px',
    border: '1px solid var(--border)',
    background: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    font: 'inherit',
    fontSize: '0.95rem'
};

export default function AnalyticsShell({ locale, view, today, initialRange }: {
    locale: string;
    view: AnalyticsView;
    today: string;
    initialRange: DateRange;
}) {
    const t = useTranslations('Analytics');
    const [range, setRange] = useState<DateRange>(initialRange);
    const [custom, setCustom] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [syncStatus, setSyncStatus] = useState<ReactNode>(null);
    /** Bumped after a sync so every dashboard refetches. */
    const [refreshKey, setRefreshKey] = useState(0);

    // The server resolved the URL's window, or the default when it named
    // none. A window remembered from another dashboard beats the default —
    // but never a window the URL asked for explicitly.
    useEffect(() => {
        const fromUrl = new URL(window.location.href).searchParams.has('from');
        if (fromUrl) return;
        const stored = readStored(today);
        if (stored && (stored.from !== initialRange.from || stored.to !== initialRange.to)) {
            setRange(stored);
            writeUrl(stored);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const apply = (next: DateRange) => {
        setRange(next);
        writeStored(next);
        writeUrl(next);
    };

    const choosePreset = (preset: RangePreset) => {
        setCustom(false);
        apply(presetRange(preset, today));
    };

    const changeCustom = (from: string, to: string) => {
        const next = clampRange(from, to, today);
        if (next) apply(next);
    };

    const preset = custom ? null : matchPreset(range, today);
    const days = daysBetween(range.from, range.to);
    const dayLabel = (date: string) =>
        new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));

    /** One line per source, in the reader's language; red when a source failed. */
    const describeSync = (r: SyncAnalyticsResult): ReactNode => {
        const skipText = (code: string, status?: number) => {
            switch (code) {
                case 'TRUNCATED': return t('sync_skip_truncated');
                case 'TOAST_ENV': return t('sync_skip_env');
                case 'TOAST_HTTP': return t('sync_skip_http', { status: status ?? 0 });
                default: return t('sync_skip_failed');
            }
        };
        const parts: { text: string; bad: boolean }[] = [];
        if (r.toast.error) parts.push({ text: t('sync_toast_failed'), bad: true });
        else {
            parts.push({ text: t('sync_toast_ok', { count: r.toast.read.length }), bad: false });
            for (const sk of r.toast.skipped) parts.push({ text: `${dayLabel(sk.date)}: ${skipText(sk.code, sk.status)}`, bad: true });
            if (r.toast.remaining > 0) parts.push({ text: t('sync_toast_remaining', { count: r.toast.remaining }), bad: false });
        }
        if (r.google.error === 'NOT_CONNECTED') parts.push({ text: t('sync_google_not_connected'), bad: false });
        else if (r.google.error === 'TIME') parts.push({ text: t('sync_google_time'), bad: false });
        else if (r.google.error) parts.push({ text: t('sync_google_failed'), bad: true });
        else parts.push({ text: t('sync_google_ok', { reviews: r.google.reviews, days: r.google.metricDays }), bad: false });
        if (r.clover.error === 'TIME') parts.push({ text: t('sync_clover_time'), bad: false });
        else if (r.clover.error) parts.push({ text: t('sync_clover_failed'), bad: true });
        else parts.push({ text: t('sync_clover_ok', { count: r.clover.items }), bad: false });
        return (
            <>
                {parts.map((p, i) => (
                    <span key={i} style={{ color: p.bad ? 'var(--danger)' : undefined }}>{i > 0 && ' · '}{p.text}</span>
                ))}
                <span style={{ color: 'var(--text-secondary)' }}> · {t('sync_took', { seconds: Math.round(r.tookMs / 1000) })}</span>
            </>
        );
    };

    const runSync = async () => {
        setSyncing(true);
        setSyncStatus(t('sync_running'));
        try {
            const r = await syncAnalytics();
            if (!r.success) { setSyncStatus(<span style={{ color: 'var(--danger)' }}>{r.code === 'NOT_ADMIN' ? t('err_admin') : t('sync_failed')}</span>); return; }
            setSyncStatus(describeSync(r));
            setRefreshKey(k => k + 1);
        } catch {
            // A rejected action (deploy mid-flight, network, the 60 s ceiling): say so, never hang on "running".
            setSyncStatus(<span style={{ color: 'var(--danger)' }}>{t('sync_rejected')}</span>);
        } finally {
            setSyncing(false);
        }
    };

    return (
        <div data-testid="analytics-page" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '1400px', margin: '0 auto' }}>
            <header style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: '1rem' }}>
                <div>
                    <div style={{ fontSize: '0.8rem', fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>{t('section')}</div>
                    <h1 style={{ fontSize: '2.5rem', margin: '0.1rem 0 0.25rem 0', color: 'var(--text-primary)' }}>{t(`title_${view}`)}</h1>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '1.05rem', margin: 0 }}>{t(`subtitle_${view}`)}</p>
                </div>

                {/* The one refresh under Analytics: every source, then every dashboard redraws. */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.4rem', maxWidth: '100%' }}>
                    <button type="button" onClick={runSync} disabled={syncing} className="btn-primary" data-testid="analytics-sync"
                        style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minHeight: '56px', padding: '0 1.75rem', borderRadius: '14px', fontSize: '1.1rem', fontWeight: 700, cursor: syncing ? 'wait' : 'pointer', opacity: syncing ? 0.7 : 1 }}>
                        <RefreshCw size={22} className={syncing ? 'an-spin' : ''} />
                        {syncing ? t('syncing') : t('sync')}
                    </button>
                    {syncStatus && <span style={{ fontSize: '0.85rem', textAlign: 'right' }}>{syncStatus}</span>}
                </div>

                {RANGED_VIEWS.includes(view) && (
                    <div data-testid="analytics-range" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.75rem' }}>
                        <div role="group" aria-label={t('range_label')} className="glass-panel" style={{ display: 'flex', gap: '2px', padding: '4px', borderRadius: '12px' }}>
                            {RANGE_PRESETS.map(p => (
                                <button key={p} type="button" onClick={() => choosePreset(p)} aria-pressed={preset === p} style={presetButton(preset === p)}>
                                    {t(`range_${p}`)}
                                </button>
                            ))}
                            <button type="button" onClick={() => setCustom(true)} aria-pressed={custom || preset === null} style={presetButton(custom || preset === null)}>
                                {t('range_custom')}
                            </button>
                        </div>
                        {(custom || preset === null) && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                    {t('range_from')}
                                    <input type="date" value={range.from} min={TOAST_FIRST_BUSINESS_DATE} max={range.to} style={dateInput}
                                        onChange={e => changeCustom(e.target.value, range.to)} />
                                </label>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                    {t('range_to')}
                                    <input type="date" value={range.to} min={range.from} max={today} style={dateInput}
                                        onChange={e => changeCustom(range.from, e.target.value)} />
                                </label>
                            </div>
                        )}
                        <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                            {t('range_showing', { from: dayLabel(range.from), to: dayLabel(range.to), days })}
                        </span>
                    </div>
                )}
            </header>

            {view === 'resumen' && <ResumenView locale={locale} range={range} today={today} refreshKey={refreshKey} />}
            {view === 'ventas' && <VentasView range={range} refreshKey={refreshKey} />}
            {view === 'cobros' && <CobrosView locale={locale} range={range} today={today} refreshKey={refreshKey} />}
            {view === 'personal' && <PersonalView locale={locale} range={range} today={today} refreshKey={refreshKey} />}
            {view === 'reputacion' && <ReputacionView locale={locale} range={range} today={today} refreshKey={refreshKey} />}

            <style jsx>{`
                @keyframes an-spin { 100% { transform: rotate(360deg); } }
                :global(.an-spin) { animation: an-spin 1s linear infinite; }
            `}</style>
        </div>
    );
}
