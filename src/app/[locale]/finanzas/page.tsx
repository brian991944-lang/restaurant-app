'use client';

// Pestaña "Finanzas" (solo Admin): explorador tipo tabla dinámica
// sobre los datos sincronizados de QuickBooks.
// Guarded client-side by AdminContext (restrictedRoutes) and server-side
// by the fusionista_admin cookie on the pivot/connect API routes.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale } from 'next-intl';
import { Download, RefreshCw, Landmark } from 'lucide-react';

type DimKey = 'account' | 'vendor' | 'month' | 'txnType' | 'classification';

const DIM_LABELS: Record<DimKey, string> = {
    account: 'Cuenta',
    vendor: 'Proveedor / Cliente',
    month: 'Mes',
    txnType: 'Tipo de transacción',
    classification: 'Clasificación',
};

const TXN_TYPES = ['Purchase', 'Bill', 'Invoice', 'JournalEntry'];

interface PivotData {
    connected: boolean;
    rowKeys: string[];
    colKeys: string[];
    cells: Record<string, Record<string, number>>;
    rowTotals: Record<string, number>;
    colTotals: Record<string, number>;
    grandTotal: number;
}

const fmt = new Intl.NumberFormat('es-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
});

function firstDayOfYear() {
    return `${new Date().getFullYear()}-01-01`;
}
function today() {
    return new Date().toISOString().slice(0, 10);
}

const cellStyle: React.CSSProperties = {
    padding: '0.65rem 0.75rem',
    textAlign: 'right',
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
};

export default function FinanzasPage() {
    const locale = useLocale();
    const [status, setStatus] = useState<{ connected: boolean; lastSync: string | null } | null>(null);
    const [rows, setRows] = useState<DimKey>('account');
    const [cols, setCols] = useState<DimKey>('month');
    const [measure, setMeasure] = useState<'sum' | 'count'>('sum');
    const [from, setFrom] = useState(firstDayOfYear());
    const [to, setTo] = useState(today());
    const [txnTypes, setTxnTypes] = useState<string[]>(['Purchase', 'Bill']);
    const [data, setData] = useState<PivotData | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        fetch('/api/quickbooks/pivot')
            .then((r) => r.json())
            .then(setStatus)
            .catch(() => setStatus({ connected: false, lastSync: null }));
    }, []);

    const runPivot = useCallback(async () => {
        if (rows === cols) {
            setError('Filas y columnas deben ser dimensiones distintas.');
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const res = await fetch('/api/quickbooks/pivot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rows, cols, measure, from, to, txnTypes }),
            });
            if (!res.ok) throw new Error('Error al consultar los datos');
            setData(await res.json());
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [rows, cols, measure, from, to, txnTypes]);

    useEffect(() => {
        if (status?.connected) runPivot();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [status?.connected]);

    const csv = useMemo(() => {
        if (!data) return '';
        const esc = (s: string | number) => `"${String(s).replace(/"/g, '""')}"`;
        const header = [DIM_LABELS[rows], ...data.colKeys, 'Total'].map(esc).join(',');
        const body = data.rowKeys.map((r) =>
            [r, ...data.colKeys.map((c) => data.cells[r]?.[c] ?? 0), data.rowTotals[r] ?? 0]
                .map(esc)
                .join(','),
        );
        const totals = ['Total', ...data.colKeys.map((c) => data.colTotals[c] ?? 0), data.grandTotal]
            .map(esc)
            .join(',');
        return [header, ...body, totals].join('\n');
    }, [data, rows]);

    const downloadCsv = () => {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `finanzas_${rows}_x_${cols}_${from}_${to}.csv`;
        a.click();
        URL.revokeObjectURL(a.href);
    };

    const toggleTxnType = (t: string) =>
        setTxnTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

    if (status && !status.connected) {
        return (
            <div style={{ maxWidth: '480px', margin: '4rem auto', textAlign: 'center' }}>
                <div className="glass-panel" style={{ padding: '2.5rem 2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                    <Landmark size={40} color="var(--accent-primary)" />
                    <h1 style={{ margin: 0, fontSize: '1.5rem' }}>Finanzas</h1>
                    <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
                        Conecta QuickBooks para sincronizar las transacciones y explorar los datos.
                    </p>
                    <a
                        href={`/api/quickbooks/connect?locale=${locale}`}
                        className="btn-primary"
                        style={{ display: 'inline-block', padding: '0.8rem 2rem', borderRadius: '12px', textDecoration: 'none', marginTop: '0.5rem' }}
                    >
                        Conectar QuickBooks
                    </a>
                </div>
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '1400px', margin: '0 auto' }}>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                    <h1 style={{ fontSize: '2.5rem', marginBottom: '0.25rem' }}>Finanzas</h1>
                    <p style={{ color: 'var(--text-secondary)' }}>Tabla dinámica sobre las transacciones de QuickBooks</p>
                </div>
                {status?.lastSync && (
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        Última sincronización: {new Date(status.lastSync).toLocaleString('es-US')}
                    </span>
                )}
            </div>

            {/* Controls */}
            <div className="glass-panel" style={{ padding: '1rem 1.5rem', display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: '1rem' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    Filas
                    <select value={rows} onChange={(e) => setRows(e.target.value as DimKey)} className="input-field" style={{ padding: '0.6rem' }}>
                        {Object.entries(DIM_LABELS).map(([k, v]) => (
                            <option key={k} value={k}>{v}</option>
                        ))}
                    </select>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    Columnas
                    <select value={cols} onChange={(e) => setCols(e.target.value as DimKey)} className="input-field" style={{ padding: '0.6rem' }}>
                        {Object.entries(DIM_LABELS).map(([k, v]) => (
                            <option key={k} value={k}>{v}</option>
                        ))}
                    </select>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    Medida
                    <select value={measure} onChange={(e) => setMeasure(e.target.value as 'sum' | 'count')} className="input-field" style={{ padding: '0.6rem' }}>
                        <option value="sum">Suma ($)</option>
                        <option value="count"># Transacciones</option>
                    </select>
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    Desde
                    <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="input-field" style={{ padding: '0.6rem' }} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    Hasta
                    <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="input-field" style={{ padding: '0.6rem' }} />
                </label>
                <button
                    onClick={runPivot}
                    disabled={loading}
                    className="btn-primary"
                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.65rem 1.25rem', borderRadius: '12px', opacity: loading ? 0.6 : 1 }}
                >
                    <RefreshCw size={16} />
                    {loading ? 'Calculando…' : 'Actualizar'}
                </button>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Tipos:</span>
                {TXN_TYPES.map((t) => {
                    const active = txnTypes.includes(t);
                    return (
                        <button
                            key={t}
                            onClick={() => toggleTxnType(t)}
                            style={{
                                padding: '0.4rem 0.9rem',
                                borderRadius: '999px',
                                fontSize: '0.85rem',
                                cursor: 'pointer',
                                border: active ? '1px solid var(--accent-primary)' : '1px solid var(--border)',
                                background: active ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                                color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                                fontWeight: active ? 600 : 400,
                                transition: 'all 0.2s',
                            }}
                        >
                            {t}
                        </button>
                    );
                })}
                {data && (
                    <button
                        onClick={downloadCsv}
                        className="btn-secondary"
                        style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem', borderRadius: '8px', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)' }}
                    >
                        <Download size={16} />
                        Exportar CSV
                    </button>
                )}
            </div>

            {error && <p style={{ color: 'var(--danger)', fontSize: '0.9rem', margin: 0 }}>{error}</p>}

            {data && data.rowKeys.length === 0 && (
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                    Sin datos para este rango. Verifica la sincronización o amplía las fechas.
                </p>
            )}

            {data && data.rowKeys.length > 0 && (
                <div className="glass-panel" style={{ overflow: 'auto', maxHeight: '70vh', padding: 0 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                        <thead style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg-secondary)' }}>
                            <tr>
                                <th style={{ ...cellStyle, textAlign: 'left', position: 'sticky', left: 0, background: 'var(--bg-secondary)', fontWeight: 500 }}>
                                    {DIM_LABELS[rows]}
                                </th>
                                {data.colKeys.map((c) => (
                                    <th key={c} style={{ ...cellStyle, fontWeight: 500 }}>{c}</th>
                                ))}
                                <th style={{ ...cellStyle, fontWeight: 700 }}>Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.rowKeys.map((r) => (
                                <tr key={r} style={{ borderTop: '1px solid var(--border)' }}>
                                    <td
                                        title={r}
                                        style={{ ...cellStyle, textAlign: 'left', position: 'sticky', left: 0, background: 'var(--bg-primary)', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis' }}
                                    >
                                        {r}
                                    </td>
                                    {data.colKeys.map((c) => {
                                        const v = data.cells[r]?.[c];
                                        return (
                                            <td key={c} style={{ ...cellStyle, color: 'var(--text-secondary)' }}>
                                                {v == null ? '—' : measure === 'sum' ? fmt.format(v) : v}
                                            </td>
                                        );
                                    })}
                                    <td style={{ ...cellStyle, fontWeight: 600 }}>
                                        {measure === 'sum' ? fmt.format(data.rowTotals[r] ?? 0) : data.rowTotals[r] ?? 0}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot style={{ position: 'sticky', bottom: 0, background: 'var(--bg-secondary)', fontWeight: 700 }}>
                            <tr style={{ borderTop: '2px solid var(--border)' }}>
                                <td style={{ ...cellStyle, textAlign: 'left', position: 'sticky', left: 0, background: 'var(--bg-secondary)' }}>Total</td>
                                {data.colKeys.map((c) => (
                                    <td key={c} style={cellStyle}>
                                        {measure === 'sum' ? fmt.format(data.colTotals[c] ?? 0) : data.colTotals[c] ?? 0}
                                    </td>
                                ))}
                                <td style={cellStyle}>
                                    {measure === 'sum' ? fmt.format(data.grandTotal) : data.grandTotal}
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            )}
        </div>
    );
}
