'use client';

import { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight, Download, RefreshCw, Package } from 'lucide-react';
import { fetchCloverItemsForSalon, importSalonDrinksFromClover } from '@/app/actions/clover';
import { getSalonStock } from '@/app/actions/inventory';

type CloverResult = Awaited<ReturnType<typeof fetchCloverItemsForSalon>>;
type CloverItem = CloverResult['items'][number];
type SalonRow = Awaited<ReturnType<typeof getSalonStock>>[number];
type ImportResult = Awaited<ReturnType<typeof importSalonDrinksFromClover>>;

// Clover sends prices as integer cents; every price on this page goes through here.
const money = (cents: number | null | undefined) =>
    typeof cents === 'number' ? `$${(cents / 100).toFixed(2)}` : '—';

const num = (value: number | null | undefined) =>
    typeof value === 'number' ? String(value) : '—';

function Badge({ label, tone }: { label: string; tone: 'success' | 'warning' | 'danger' }) {
    const color = `var(--${tone})`;
    return (
        <span style={{
            padding: '0.25rem 0.7rem',
            borderRadius: '12px',
            fontSize: '0.8rem',
            fontWeight: 600,
            whiteSpace: 'nowrap',
            color,
            background: `color-mix(in srgb, ${color} 18%, transparent)`,
            border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`
        }}>
            {label}
        </span>
    );
}

export default function InventorySalonPage() {
    const [isImportOpen, setIsImportOpen] = useState(false);

    const [clover, setClover] = useState<CloverResult | null>(null);
    const [isLoadingClover, setIsLoadingClover] = useState(false);
    const [cloverError, setCloverError] = useState<string | null>(null);
    const [checked, setChecked] = useState<Set<string>>(new Set());

    const [isImporting, setIsImporting] = useState(false);
    const [importResult, setImportResult] = useState<ImportResult | null>(null);
    const [importError, setImportError] = useState<string | null>(null);

    const [salonRows, setSalonRows] = useState<SalonRow[]>([]);
    const [isLoadingSalon, setIsLoadingSalon] = useState(true);
    const [salonError, setSalonError] = useState<string | null>(null);

    const loadClover = useCallback(async () => {
        setIsLoadingClover(true);
        setCloverError(null);
        try {
            const result = await fetchCloverItemsForSalon();
            setClover(result);
            // Pre-check the items that already track stock in Clover and are not
            // yet linked to an ingredient — those are the safe defaults to import.
            const drinks = result.items.filter(i => i.categoryName === 'Drinks');
            const linked = new Set(result.alreadyLinked);
            setChecked(new Set(
                drinks.filter(i => i.autoManage && !linked.has(i.id)).map(i => i.id)
            ));
        } catch (e) {
            setCloverError(e instanceof Error ? e.message : String(e));
        } finally {
            setIsLoadingClover(false);
        }
    }, []);

    const loadSalon = useCallback(async () => {
        setIsLoadingSalon(true);
        setSalonError(null);
        try {
            setSalonRows(await getSalonStock());
        } catch (e) {
            setSalonError(e instanceof Error ? e.message : String(e));
        } finally {
            setIsLoadingSalon(false);
        }
    }, []);

    useEffect(() => { loadSalon(); }, [loadSalon]);

    const handleToggleImport = () => {
        const next = !isImportOpen;
        setIsImportOpen(next);
        if (next && !clover && !isLoadingClover) loadClover();
    };

    const toggleChecked = (id: string) => {
        setChecked(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const handleImport = async () => {
        setIsImporting(true);
        setImportError(null);
        setImportResult(null);
        try {
            const result = await importSalonDrinksFromClover([...checked]);
            setImportResult(result);
            await Promise.all([loadClover(), loadSalon()]);
        } catch (e) {
            setImportError(e instanceof Error ? e.message : String(e));
        } finally {
            setIsImporting(false);
        }
    };

    const drinks = (clover?.items ?? []).filter(i => i.categoryName === 'Drinks');
    const linkedIds = new Set(clover?.alreadyLinked ?? []);

    const cellStyle = { padding: '1rem 1.25rem', fontSize: '1.05rem' };
    const headStyle = { padding: '1rem 1.25rem', fontWeight: 500, fontSize: '0.95rem' };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', maxWidth: '1200px', margin: '0 auto', padding: '2rem' }}>

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
                <div>
                    <h1 style={{ fontSize: '2.5rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Inventario Salón</h1>
                    <p style={{ color: 'var(--text-secondary)' }}>Productos del salón y su stock actual.</p>
                </div>
                <button
                    onClick={loadSalon}
                    disabled={isLoadingSalon}
                    className="btn-secondary"
                    style={{
                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                        borderRadius: '8px', padding: '0.8rem 1.2rem', minHeight: '52px', fontSize: '1rem',
                        background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)',
                        cursor: isLoadingSalon ? 'not-allowed' : 'pointer'
                    }}
                >
                    <RefreshCw size={20} className={isLoadingSalon ? 'spin-anim' : ''} />
                    <span>Actualizar</span>
                </button>
            </div>

            {/* SECTION A — Importar desde Clover */}
            <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <button
                    onClick={handleToggleImport}
                    className="btn-primary"
                    style={{
                        display: 'flex', alignItems: 'center', gap: '0.75rem',
                        borderRadius: '8px', padding: '0.9rem 1.4rem', minHeight: '56px',
                        fontSize: '1.1rem', fontWeight: 600, alignSelf: 'flex-start'
                    }}
                >
                    {isImportOpen ? <ChevronDown size={22} /> : <ChevronRight size={22} />}
                    <Download size={20} />
                    <span>Importar desde Clover</span>
                </button>

                {isImportOpen && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                        {isLoadingClover && (
                            <p style={{ color: 'var(--text-secondary)', fontSize: '1.05rem' }}>Cargando artículos de Clover...</p>
                        )}

                        {cloverError && (
                            <p style={{ color: 'var(--danger)', fontSize: '1.05rem' }}>Error al consultar Clover: {cloverError}</p>
                        )}

                        {clover?.error && (
                            <p style={{ color: 'var(--warning)', fontSize: '1.05rem' }}>{clover.error}</p>
                        )}

                        {!isLoadingClover && !cloverError && clover && drinks.length === 0 && (
                            <p style={{ color: 'var(--text-secondary)', fontSize: '1.05rem' }}>
                                No se encontraron artículos en la categoría &quot;Drinks&quot;.
                            </p>
                        )}

                        {drinks.length > 0 && (
                            <>
                                <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden' }}>
                                    {drinks.map((item: CloverItem, index) => {
                                        const isLinked = linkedIds.has(item.id);
                                        return (
                                            <label
                                                key={item.id}
                                                style={{
                                                    display: 'flex', alignItems: 'center', gap: '1rem',
                                                    padding: '1rem 1.25rem', minHeight: '64px',
                                                    borderTop: index === 0 ? 'none' : '1px solid var(--border)',
                                                    cursor: isLinked ? 'not-allowed' : 'pointer',
                                                    opacity: isLinked ? 0.6 : 1,
                                                    flexWrap: 'wrap'
                                                }}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={checked.has(item.id)}
                                                    disabled={isLinked}
                                                    onChange={() => toggleChecked(item.id)}
                                                    style={{ width: '28px', height: '28px', flexShrink: 0, cursor: isLinked ? 'not-allowed' : 'pointer' }}
                                                />
                                                <span style={{ flex: 1, minWidth: '200px', fontSize: '1.1rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                                                    {item.name}
                                                </span>
                                                <span style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                                                    {money(item.price)}
                                                </span>
                                                <span style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                    {isLinked && <Badge label="Ya importado" tone="success" />}
                                                    {!item.available && <Badge label="No disponible" tone="danger" />}
                                                    {!item.autoManage && <Badge label="Sin auto-stock" tone="warning" />}
                                                </span>
                                            </label>
                                        );
                                    })}
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                                    <button
                                        onClick={handleImport}
                                        disabled={isImporting || checked.size === 0}
                                        className="btn-primary"
                                        style={{
                                            borderRadius: '8px', padding: '0.9rem 1.6rem', minHeight: '56px',
                                            fontSize: '1.1rem', fontWeight: 600,
                                            opacity: isImporting || checked.size === 0 ? 0.5 : 1,
                                            cursor: isImporting || checked.size === 0 ? 'not-allowed' : 'pointer'
                                        }}
                                    >
                                        {isImporting ? 'Importando...' : 'Importar seleccionados'}
                                    </button>
                                    <span style={{ color: 'var(--text-secondary)', fontSize: '1rem' }}>
                                        {checked.size} seleccionado{checked.size === 1 ? '' : 's'}
                                    </span>
                                </div>
                            </>
                        )}

                        {importError && (
                            <p style={{ color: 'var(--danger)', fontSize: '1.05rem' }}>Error al importar: {importError}</p>
                        )}

                        {importResult && (
                            <div style={{ padding: '1.25rem', borderRadius: '12px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                <p style={{ margin: 0, fontSize: '1.1rem', color: 'var(--success)', fontWeight: 600 }}>
                                    Creados: {importResult.created} · Actualizados: {importResult.updated}
                                </p>
                                {importResult.skipped.length > 0 && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                        <p style={{ margin: 0, fontSize: '1rem', color: 'var(--warning)', fontWeight: 600 }}>
                                            Omitidos: {importResult.skipped.length}
                                        </p>
                                        {importResult.skipped.map((s, i) => (
                                            <p key={`${s.name}-${i}`} style={{ margin: 0, fontSize: '1rem', color: 'var(--text-secondary)' }}>
                                                {s.name} — {s.reason}
                                            </p>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* SECTION B — Inventario del salón */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <h2 style={{ fontSize: '1.5rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>Productos del Salón</h2>

                {salonError && (
                    <p style={{ color: 'var(--danger)', fontSize: '1.05rem' }}>Error al cargar el inventario: {salonError}</p>
                )}

                {isLoadingSalon && !salonError && (
                    <p style={{ color: 'var(--text-secondary)', fontSize: '1.05rem' }}>Cargando productos...</p>
                )}

                {!isLoadingSalon && !salonError && salonRows.length === 0 && (
                    <div className="glass-panel" style={{ padding: '3rem', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                        <div style={{ background: 'var(--bg-secondary)', padding: '1.5rem', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Package size={48} color="var(--accent-secondary)" />
                        </div>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem', margin: 0 }}>No hay productos en el salón todavía.</p>
                    </div>
                )}

                {!isLoadingSalon && !salonError && salonRows.length > 0 && (
                    <div className="glass-panel" style={{ padding: '0', overflowX: 'auto' }}>
                        <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse', minWidth: '760px' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                                    <th style={headStyle}>Nombre</th>
                                    <th style={{ ...headStyle, textAlign: 'center' }}>Bodega</th>
                                    <th style={{ ...headStyle, textAlign: 'center' }}>Front</th>
                                    <th style={{ ...headStyle, textAlign: 'center' }}>Total</th>
                                    <th style={{ ...headStyle, textAlign: 'center' }}>Par</th>
                                    <th style={{ ...headStyle, textAlign: 'right' }}>Precio</th>
                                </tr>
                            </thead>
                            <tbody>
                                {salonRows.map(row => {
                                    const stock = row.salonStock;
                                    const total = stock ? stock.qtyBodega + stock.qtyFront : null;
                                    return (
                                        <tr key={row.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                            <td style={{ ...cellStyle, fontWeight: 500, color: 'var(--text-primary)' }}>
                                                {row.name}
                                                {!row.isActive && (
                                                    <span style={{ marginLeft: '0.6rem' }}>
                                                        <Badge label="Inactivo" tone="danger" />
                                                    </span>
                                                )}
                                            </td>
                                            <td style={{ ...cellStyle, textAlign: 'center' }}>{num(stock?.qtyBodega)}</td>
                                            <td style={{ ...cellStyle, textAlign: 'center' }}>{num(stock?.qtyFront)}</td>
                                            <td style={{ ...cellStyle, textAlign: 'center', fontWeight: 700 }}>{num(total)}</td>
                                            <td style={{ ...cellStyle, textAlign: 'center' }}>{num(stock?.parFront)}</td>
                                            <td style={{ ...cellStyle, textAlign: 'right' }}>{money(stock?.salePrice)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
