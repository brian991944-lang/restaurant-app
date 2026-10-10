'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { RefreshCw } from 'lucide-react';
import { formatMoney } from '@/lib/money';
import { getToastDailySales, refreshToastDailySales } from '@/app/actions/toastDailySales';
import type { DailySalesRow } from '@/lib/pos/toastDailySales';

/**
 * Ventas netas (Toast): the day's money with the Clover-style distinction
 * Toast's own reports do not make — only paid or closed checks count as net
 * sales; open checks are shown beside them, never added in. Surcharges and
 * service charges are their own cards, not part of net sales.
 *
 * Reads PosDailySales (written by the refresh button and the nightly cron);
 * nothing here calls Toast directly.
 */

const PAID_COLOR = 'var(--accent-primary)';
const OPEN_COLOR = '#c98500'; // the Dashboard's amber, for "not yet in the register"
const NEUTRAL_COLOR = 'var(--text-secondary)';

const dayLabel = (date: string) =>
    new Intl.DateTimeFormat('es', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
        .format(new Date(`${date}T12:00:00Z`));

const timeLabel = (iso: string) =>
    new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' }).format(new Date(iso));

/** Toast's own net sales: it counts open checks and non-gratuity service charges. */
const toastTotal = (r: DailySalesRow) => r.netPaidCents + r.netOpenCents + r.surchargeCents + r.otherChargeCents;
const serviceCharges = (r: DailySalesRow) => r.gratuityCents + r.otherChargeCents;

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

export default function VentasNetas() {
    const [rows, setRows] = useState<DailySalesRow[]>([]);
    const [today, setToday] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    /** "3 de 12 · mar, 29 sept" while a backfill runs; null otherwise. */
    const [backfill, setBackfill] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const load = useCallback(async (): Promise<DailySalesRow[]> => {
        try {
            const res = await getToastDailySales();
            if (res.success) {
                setRows(res.rows);
                setToday(res.today);
                setError(null);
                return res.rows;
            }
            setError(res.error ?? 'No se pudieron leer las ventas.');
        } catch {
            // A rejected action (deploy mid-flight, network) must not leave the
            // panel on "Cargando…" forever.
            setError('No se pudieron leer las ventas. Recarga la página.');
        } finally {
            setLoading(false);
        }
        return [];
    }, []);

    useEffect(() => { load(); }, [load]);

    const busy = refreshing || backfill !== null;

    /** Read every day never read yet, oldest first, one request per day. */
    const handleBackfill = async () => {
        const missing = rows.filter(r => r.computedAt === null).map(r => r.date);
        if (missing.length === 0) return;
        setNotice(null);
        setError(null);
        const skipped: string[] = [];
        try {
            for (let i = 0; i < missing.length; i++) {
                const date = missing[i];
                setBackfill(`${i + 1} de ${missing.length} · ${dayLabel(date)}`);
                const res = await refreshToastDailySales(date);
                if (!res.success) {
                    setError(`${dayLabel(date)}: ${res.error ?? 'No se pudo leer.'} Se detuvo ahí.`);
                    return;
                }
                for (const r of res.reports ?? []) if (r.skipped) skipped.push(`${dayLabel(r.date)}: ${r.skipped}`);
                await load(); // the row fills in as the loop goes
            }
            if (skipped.length) setNotice(skipped.join(' · '));
        } catch {
            setError('La lectura se interrumpió. Vuelve a tocar "Leer días sin datos" para seguir.');
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
                setError(res.error ?? 'No se pudo actualizar.');
                return;
            }
            const skipped = (res.reports ?? []).filter(r => r.skipped);
            if (skipped.length) setNotice(skipped.map(r => `${dayLabel(r.date)}: ${r.skipped}`).join(' · '));
            await load();
        } catch {
            setError('No se pudo actualizar. Inténtalo de nuevo.');
        } finally {
            setRefreshing(false);
        }
    };

    const todayRow = rows.find(r => r.date === today) ?? null;
    const hasToday = !!todayRow?.computedAt;
    const money = (cents: number | undefined) => (hasToday && cents !== undefined ? formatMoney(cents) : '—');
    const history = [...rows].reverse(); // newest first
    const maxTotal = Math.max(0, ...rows.map(toastTotal));
    const missingCount = rows.filter(r => r.computedAt === null).length;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                <div>
                    <h2 style={{ fontSize: '1.75rem', margin: 0 }}>Ventas netas · Toast</h2>
                    <p style={{ color: 'var(--text-secondary)', margin: '0.25rem 0 0 0' }}>
                        Solo cuentan los checks cobrados o cerrados. Lo abierto se muestra aparte y nunca se suma.
                    </p>
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
                                {backfill ? `Leyendo ${backfill}` : `Leer ${missingCount} día${missingCount === 1 ? '' : 's'} sin datos`}
                            </button>
                        )}
                        <button
                            onClick={handleRefresh}
                            disabled={busy}
                            className="btn-primary"
                            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderRadius: '8px', padding: '0.6rem 1.5rem', minHeight: '44px' }}
                        >
                            <RefreshCw size={18} className={refreshing ? 'vn-spin' : ''} />
                            {refreshing ? 'Leyendo Toast…' : 'Actualizar'}
                        </button>
                    </div>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        {hasToday && todayRow?.computedAt
                            ? `Hoy ${dayLabel(todayRow.date)} · actualizado a las ${timeLabel(todayRow.computedAt)}`
                            : loading ? 'Cargando…' : 'Hoy no se ha leído todavía. Toca Actualizar.'}
                    </span>
                </div>
            </div>

            {error && <p style={{ margin: 0, color: 'var(--danger)' }}>{error}</p>}
            {notice && <p style={{ margin: 0, color: 'var(--warning)' }}>{notice}</p>}

            {/* Today: the three figures that matter, then what is not a sale. */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                <Card big label="Ventas netas (cobradas)" value={money(todayRow?.netPaidCents)} color={PAID_COLOR}
                    sub={hasToday ? `${todayRow!.paidChecks} checks cobrados` : undefined} />
                <Card big label="Abierto (sin cobrar)" value={money(todayRow?.netOpenCents)} color={OPEN_COLOR}
                    sub={hasToday ? `${todayRow!.openChecks} checks abiertos · no se suma` : undefined} />
                <Card big label="Total Toast (referencia)" value={money(todayRow ? toastTotal(todayRow) : undefined)} color={NEUTRAL_COLOR}
                    sub="Cobrado + abierto + recargos, como lo suma Toast" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                <Card label="Recargo tarjeta (CC)" value={money(todayRow?.surchargeCents)} color={NEUTRAL_COLOR}
                    sub="Aparte de las ventas netas" />
                <Card label="Cargo por servicio" value={money(todayRow ? serviceCharges(todayRow) : undefined)} color={NEUTRAL_COLOR}
                    sub={hasToday ? `${formatMoney(todayRow!.gratuityCents)} propina de grupo · aparte de las ventas netas` : 'Aparte de las ventas netas'} />
            </div>

            {/* Every day since Toast started (last 60 at most), newest first. */}
            <div className="glass-panel" style={{ padding: '0.5rem 0', overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '820px' }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                            <th style={{ ...headCell, textAlign: 'left' }}>Día</th>
                            <th style={{ ...headCell, textAlign: 'left', minWidth: '180px' }}>Cobrado / abierto</th>
                            <th style={{ ...headCell, ...numeric }}>Ventas netas</th>
                            <th style={{ ...headCell, ...numeric }}>Abierto</th>
                            <th style={{ ...headCell, ...numeric }}>Total Toast</th>
                            <th style={{ ...headCell, ...numeric }}>Recargo tarjeta</th>
                            <th style={{ ...headCell, ...numeric }}>Cargo servicio</th>
                            <th style={{ ...headCell, ...numeric }}>Checks</th>
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
                                        {dayLabel(r.date)}{isToday ? ' · hoy' : ''}
                                    </td>
                                    <td style={cell}>
                                        {r.computedAt ? (
                                            <div style={{ display: 'flex', height: '14px', borderRadius: '4px', overflow: 'hidden', background: 'rgba(127,127,127,0.12)' }}>
                                                <div style={{ width: `${paidPct}%`, background: PAID_COLOR }} />
                                                <div style={{ width: `${openPct}%`, background: OPEN_COLOR }} />
                                            </div>
                                        ) : <span style={{ fontSize: '0.85rem', fontStyle: 'italic' }}>Sin leer</span>}
                                    </td>
                                    <td style={{ ...cell, ...numeric, fontWeight: 600 }}>{r.computedAt ? formatMoney(r.netPaidCents) : '—'}</td>
                                    <td style={{ ...cell, ...numeric, color: r.computedAt && r.netOpenCents > 0 ? OPEN_COLOR : undefined }}>{r.computedAt ? formatMoney(r.netOpenCents) : '—'}</td>
                                    <td style={{ ...cell, ...numeric }}>{r.computedAt ? formatMoney(total) : '—'}</td>
                                    <td style={{ ...cell, ...numeric }}>{r.computedAt ? formatMoney(r.surchargeCents) : '—'}</td>
                                    <td style={{ ...cell, ...numeric }}>{r.computedAt ? formatMoney(serviceCharges(r)) : '—'}</td>
                                    <td style={{ ...cell, ...numeric, color: 'var(--text-secondary)' }}>{r.computedAt ? `${r.paidChecks} / ${r.openChecks}` : '—'}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Ventas netas = platos y bebidas después de descuentos, menos reembolsos, de checks con pago aplicado o cerrados. Sin impuestos, propinas, propina de grupo ni recargos.
                Abierto = lo mismo sobre checks sin cobrar. Días de Toast (cambian a las 4 AM). El cron de la madrugada relee los últimos 3 días, así que un check que cierra tarde pasa solo a cobrado.
            </p>

            <style jsx>{`
                @keyframes vn-spin { 100% { transform: rotate(360deg); } }
                :global(.vn-spin) { animation: vn-spin 1s linear infinite; }
            `}</style>
        </div>
    );
}
