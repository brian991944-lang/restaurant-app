'use client';

import { useState, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { getSalesAuditData, getToastSalesAuditData, type ToastAuditDay } from '@/app/actions/sales';
import { syncCloverSales, getLastSyncTime } from '@/app/actions/clover';
import { TrendingUp, RefreshCw } from 'lucide-react';
import VentasNetas from './VentasNetas';

/**
 * Analytics › Ventas: the Ventas netas panel (today's money and every day
 * since Toast started) followed by the Clover and Toast item audits. This is
 * the old /sales page moved under the Analytics section unchanged; the shell
 * above it owns the title, and the Sales namespace still owns every string.
 */

/** 'Oct 9' / '9 oct' for a 'YYYY-MM-DD' business date, in the reader's language. */
const dayLabel = (locale: string, date: string) =>
    new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));

export default function VentasView() {
    const t = useTranslations('Sales');
    const locale = useLocale();
    const [salesData, setSalesData] = useState<{ grouped: Record<string, any>; days: string[] }>({ grouped: {}, days: [] });
    const [lastSync, setLastSync] = useState<string | null>(null);
    const [isSyncing, setIsSyncing] = useState(false);
    const [toastDays, setToastDays] = useState<ToastAuditDay[]>([]);
    const [toastError, setToastError] = useState<string | null>(null);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        const [salesRes, syncRes, toastRes] = await Promise.all([getSalesAuditData(), getLastSyncTime(), getToastSalesAuditData()]);
        if (salesRes.success) {
            setSalesData({ grouped: salesRes.grouped ?? {}, days: salesRes.days ?? [] });
        }
        setLastSync(syncRes);
        setToastDays(toastRes.days);
        setToastError(toastRes.success ? null : t('toast_err'));
    };

    const handleSync = async () => {
        setIsSyncing(true);
        const res = await syncCloverSales();
        if (res.success) {
            alert(t('sync_ok', { count: res.count ?? 0 }));
            loadData();
        } else {
            alert(t('sync_failed'));
        }
        setIsSyncing(false);
    };

    // The server names the two fallback groups by their Spanish sentinels; show them in the reader's language.
    const categoryLabel = (name: string) =>
        name === 'Sin vincular' ? t('unlinked') : name === 'Sin categoría' ? t('uncategorized') : name;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            {/* The day's money first; the item audits below are counts, not dollars. */}
            <VentasNetas />

            {/* Header & Sync Button */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    {/* A section heading now: the Analytics shell above owns the page title. */}
                    <h2 style={{ fontSize: '1.75rem', margin: 0, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <TrendingUp size={26} color="var(--accent-primary)" />
                        {t('audit_title')}
                    </h2>
                    <p style={{ color: 'var(--text-secondary)', margin: '0.25rem 0 0 0' }}>{t('audit_subtitle')}</p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
                    <button
                        onClick={handleSync}
                        disabled={isSyncing}
                        className="btn-primary"
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderRadius: '8px', padding: '0.6rem 1.5rem' }}
                    >
                        <RefreshCw size={18} className={isSyncing ? "spin" : ""} />
                        {isSyncing ? t('syncing') : t('sync_now')}
                    </button>
                    {lastSync && (
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            {t('last_sync', { time: new Date(lastSync).toLocaleString(locale) })}
                        </span>
                    )}
                </div>
            </div>

            {/* 3-Column Layout: Left (Oldest) to Right (Newest) */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.5rem' }}>
                {salesData.days.map((date: string, idx: number) => {
                    const groupForDay = salesData.grouped[date] || {};
                    const categories = Object.keys(groupForDay).sort((a, b) => a.localeCompare(b));

                    return (
                        <div key={date} className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1.5rem' }}>
                            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, borderBottom: '2px solid var(--border)', paddingBottom: '0.5rem', margin: 0, textAlign: 'center', color: idx === 2 ? 'var(--accent-primary)' : 'var(--text-primary)' }}>
                                {dayLabel(locale, date)} {idx === 2 && t('today_paren')}
                            </h2>

                            {categories.length === 0 ? (
                                <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '2rem 0' }}>{t('no_sales')}</div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                    {categories.map(cat => {
                                        const items = Object.keys(groupForDay[cat]).sort((a, b) => a.localeCompare(b));

                                        return (
                                            <div key={cat} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                                {/* Category Subtitle */}
                                                <h3 style={{ fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-secondary)', margin: 0, background: 'rgba(255,255,255,0.03)', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>
                                                    {cat}
                                                </h3>

                                                {/* Items block */}
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                                    {items.map(itemName => {
                                                        const itemData = groupForDay[cat][itemName];
                                                        const modifiers = Object.keys(itemData.modifiers || {}).sort((a, b) => a.localeCompare(b));

                                                        return (
                                                            <div key={itemName} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', padding: '0.5rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', border: '1px solid var(--border)' }}>
                                                                {/* Item Row */}
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                                    <span style={{ fontWeight: 600 }}>{itemName}</span>
                                                                    <span style={{ fontWeight: 700, background: 'rgba(255,255,255,0.1)', padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.9rem' }}>{itemData.qty}</span>
                                                                </div>

                                                                {/* Modifier Rows */}
                                                                {modifiers.length > 0 && (
                                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', paddingLeft: '1rem', borderLeft: '2px solid var(--border)', marginLeft: '0.5rem', marginTop: '0.25rem' }}>
                                                                        {modifiers.map(modName => (
                                                                            <div key={modName} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                                                                <span>+ {modName}</span>
                                                                                <span style={{ fontWeight: 500 }}>{itemData.modifiers[modName]}</span>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Toast: its own section, never summed with Clover above. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                    <h2 style={{ fontSize: '1.75rem', margin: 0 }}>{t('toast_title')}</h2>
                    <p style={{ color: 'var(--text-secondary)', margin: '0.25rem 0 0 0' }}>{t('toast_subtitle')}</p>
                </div>
                {toastError && <p style={{ margin: 0, color: 'var(--danger)' }}>{toastError}</p>}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.5rem' }}>
                    {toastDays.map((day, idx) => (
                        <div key={day.date} className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1.5rem' }}>
                            <h3 style={{ fontSize: '1.25rem', fontWeight: 600, borderBottom: '2px solid var(--border)', paddingBottom: '0.5rem', margin: 0, textAlign: 'center', color: idx === toastDays.length - 1 ? 'var(--accent-primary)' : 'var(--text-primary)' }}>
                                {dayLabel(locale, day.date)} {idx === toastDays.length - 1 && t('today_paren')} · Toast
                            </h3>
                            {day.categories.length === 0 ? (
                                <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '2rem 0' }}>{t('toast_no_sales')}</div>
                            ) : day.categories.map(cat => (
                                <div key={cat.name} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    <h4 style={{ fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '1px', margin: 0, padding: '0.2rem 0.5rem', borderRadius: '4px', background: 'rgba(255,255,255,0.03)', color: cat.name === 'Sin vincular' ? 'var(--warning)' : 'var(--text-secondary)' }}>
                                        {categoryLabel(cat.name)}
                                    </h4>
                                    {cat.items.map(it => (
                                        <div key={it.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem', padding: '0.5rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', border: '1px solid var(--border)' }}>
                                            <span style={{ fontWeight: 600 }}>
                                                {it.name}
                                                {it.voidedQty > 0 && (
                                                    <span style={{ fontWeight: 400, fontSize: '0.85rem', color: 'var(--text-secondary)' }}> · {t('voided', { count: it.voidedQty })}</span>
                                                )}
                                            </span>
                                            <span style={{ fontWeight: 700, background: 'rgba(255,255,255,0.1)', padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.9rem' }}>{it.qty}</span>
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            </div>

            <style jsx>{`
                @keyframes spin { 100% { transform: rotate(360deg); } }
                .spin { animation: spin 1s linear infinite; }
            `}</style>
        </div>
    );
}
