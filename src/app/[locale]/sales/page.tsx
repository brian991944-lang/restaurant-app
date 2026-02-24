'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { getSalesAuditData } from '@/app/actions/sales';
import { syncCloverSales, getLastSyncTime } from '@/app/actions/clover';
import { TrendingUp, RefreshCw } from 'lucide-react';

export default function SalesAuditPage() {
    const t = useTranslations('Nav'); // Reusing nav translation for title
    const [salesData, setSalesData] = useState<any>({ grouped: {}, days: [] });
    const [lastSync, setLastSync] = useState<string | null>(null);
    const [isSyncing, setIsSyncing] = useState(false);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        const [salesRes, syncRes] = await Promise.all([getSalesAuditData(), getLastSyncTime()]);
        if (salesRes.success) {
            setSalesData({ grouped: salesRes.grouped, days: salesRes.days });
        }
        setLastSync(syncRes);
    };

    const handleSync = async () => {
        setIsSyncing(true);
        const res = await syncCloverSales();
        if (res.success) {
            alert(`Clover Sync Success: ${res.count} items processed!`);
            loadData();
        } else {
            alert('Clover Sync Failed.');
        }
        setIsSyncing(false);
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            {/* Header & Sync Button */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <h1 style={{ fontSize: '2.5rem', marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <TrendingUp size={32} color="var(--accent-primary)" />
                        Sales Audit
                    </h1>
                    <p style={{ color: 'var(--text-secondary)' }}>3-Day Rolling View of items and modifiers sold.</p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
                    <button
                        onClick={handleSync}
                        disabled={isSyncing}
                        className="btn-primary"
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderRadius: '8px', padding: '0.6rem 1.5rem' }}
                    >
                        <RefreshCw size={18} className={isSyncing ? "spin" : ""} />
                        {isSyncing ? 'Syncing...' : 'Sync Now'}
                    </button>
                    {lastSync && <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Last Sync: {new Date(lastSync).toLocaleString()}</span>}
                </div>
            </div>

            {/* 3-Column Layout: Left (Oldest) to Right (Newest) */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.5rem' }}>
                {salesData.days && salesData.days.map((dateStr: string, idx: number) => {
                    const groupForDay = salesData.grouped[dateStr] || {};
                    const categories = Object.keys(groupForDay).sort((a, b) => a.localeCompare(b));

                    return (
                        <div key={dateStr} className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1.5rem' }}>
                            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, borderBottom: '2px solid rgba(255,255,255,0.1)', paddingBottom: '0.5rem', margin: 0, textAlign: 'center', color: idx === 2 ? 'var(--accent-primary)' : 'var(--text-primary)' }}>
                                {dateStr} {idx === 2 && '(Today)'}
                            </h2>

                            {categories.length === 0 ? (
                                <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '2rem 0' }}>No sales data</div>
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
                                                            <div key={itemName} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', padding: '0.5rem', background: 'rgba(0,0,0,0.2)', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.02)' }}>
                                                                {/* Item Row */}
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                                    <span style={{ fontWeight: 600 }}>{itemName}</span>
                                                                    <span style={{ fontWeight: 700, background: 'rgba(255,255,255,0.1)', padding: '0.1rem 0.4rem', borderRadius: '4px', fontSize: '0.9rem' }}>{itemData.qty}</span>
                                                                </div>

                                                                {/* Modifier Rows */}
                                                                {modifiers.length > 0 && (
                                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem', paddingLeft: '1rem', borderLeft: '2px solid rgba(255,255,255,0.05)', marginLeft: '0.5rem', marginTop: '0.25rem' }}>
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

            <style jsx>{`
                @keyframes spin { 100% { transform: rotate(360deg); } }
                .spin { animation: spin 1s linear infinite; }
            `}</style>
        </div>
    );
}
