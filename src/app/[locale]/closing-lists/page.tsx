'use client';

import { useState, useEffect, useCallback } from 'react';
import { Package, LayoutDashboard } from 'lucide-react';
import { useLocale } from 'next-intl';
import { useAdmin } from '@/components/AdminContext';
import { getWaitStaff } from '@/app/actions/clover';
import { getSalonStock, restockSalonItem } from '@/app/actions/inventory';

type SalonRow = Awaited<ReturnType<typeof getSalonStock>>[number];
type StaffMember = Awaited<ReturnType<typeof getWaitStaff>>['staff'][number];

const NO_GROUP = 'Sin grupo';

/**
 * Front-of-house restock view. Deliberately minimal: no prices, no bodega or
 * par numbers, no editing — just what to carry out and how many.
 */
function RestockView() {
    const [staff, setStaff] = useState<StaffMember[]>([]);
    const [staffError, setStaffError] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState('');

    const [rows, setRows] = useState<SalonRow[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    const [busyId, setBusyId] = useState<string | null>(null);
    const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
    const [customOpen, setCustomOpen] = useState<Record<string, boolean>>({});
    const [customQty, setCustomQty] = useState<Record<string, string>>({});
    const [done, setDone] = useState<{ id: string; name: string; qty: number }[]>([]);

    // `quiet` skips the loading state so a post-restock refresh does not blank
    // the list out from under the worker.
    const loadRows = useCallback(async ({ quiet = false }: { quiet?: boolean } = {}) => {
        if (!quiet) setIsLoading(true);
        try {
            setRows(await getSalonStock());
            setLoadError(null);
        } catch (e) {
            // On a quiet refresh the restock itself already succeeded, so the
            // optimistically-updated list is kept rather than replaced by an
            // error that would misrepresent what happened.
            if (!quiet) setLoadError(e instanceof Error ? e.message : String(e));
        } finally {
            if (!quiet) setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        let cancelled = false;
        getWaitStaff()
            .then(r => {
                if (cancelled) return;
                setStaff(r.staff);
                if (r.error) setStaffError(r.error);
            })
            .catch(e => { if (!cancelled) setStaffError(e instanceof Error ? e.message : String(e)); });

        loadRows();

        return () => { cancelled = true; };
    }, [loadRows]);

    const selected = staff.find(s => s.id === selectedId) ?? null;

    // Only items that are short on the floor AND have stock in the bodega to
    // cover it — anything else is not actionable by a worker.
    const pending = rows
        .filter(r => {
            const s = r.salonStock;
            if (!s) return false;
            return s.parFront - s.qtyFront > 0 && s.qtyBodega > 0;
        })
        .sort((a, b) => {
            const ga = a.salonStock?.salonGroup || NO_GROUP;
            const gb = b.salonStock?.salonGroup || NO_GROUP;
            const byGroup = ga.localeCompare(gb, 'es');
            return byGroup !== 0 ? byGroup : a.name.localeCompare(b.name, 'es');
        });

    const grouped = new Map<string, SalonRow[]>();
    for (const row of pending) {
        const key = row.salonStock?.salonGroup || NO_GROUP;
        const bucket = grouped.get(key);
        if (bucket) bucket.push(row);
        else grouped.set(key, [row]);
    }

    const suggestedFor = (row: SalonRow) => {
        const s = row.salonStock!;
        return Math.min(s.parFront - s.qtyFront, s.qtyBodega);
    };

    const handleRestock = async (row: SalonRow, qty: number) => {
        if (!selected) return;
        if (!Number.isInteger(qty) || qty <= 0) {
            setRowErrors(prev => ({ ...prev, [row.id]: 'La cantidad debe ser un número entero positivo.' }));
            return;
        }

        setBusyId(row.id);
        setRowErrors(prev => {
            const next = { ...prev };
            delete next[row.id];
            return next;
        });

        try {
            const result = await restockSalonItem(row.id, qty, selected.id, selected.name);
            if (!result.success) {
                setRowErrors(prev => ({ ...prev, [row.id]: result.error ?? 'No se pudo reponer.' }));
                return;
            }

            // Drop the row immediately for instant feedback, then refetch so the
            // list reflects the real state — including a partial restock, where
            // the item should reappear with a smaller Sacar rather than vanish.
            setRows(prev => prev.filter(r => r.id !== row.id));
            setDone(prev => [...prev, { id: row.id, name: row.name, qty }]);
            setTimeout(() => setDone(prev => prev.filter(d => d.id !== row.id)), 5000);
            await loadRows({ quiet: true });
        } catch (e) {
            setRowErrors(prev => ({ ...prev, [row.id]: e instanceof Error ? e.message : String(e) }));
        } finally {
            setBusyId(null);
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

            <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                <label style={{ fontSize: '1.1rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                    ¿Quién eres?
                </label>
                <select
                    value={selectedId}
                    onChange={e => setSelectedId(e.target.value)}
                    style={{
                        padding: '0.9rem 1rem', minHeight: '64px', fontSize: '1.25rem',
                        borderRadius: '8px', color: 'var(--text-primary)',
                        background: 'var(--bg-primary)', border: '1px solid var(--border)',
                        cursor: 'pointer', width: '100%'
                    }}
                >
                    <option value="">¿Quién eres?</option>
                    {staff.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                </select>
                {staffError && (
                    <p style={{ margin: 0, color: 'var(--danger)', fontSize: '1rem' }}>{staffError}</p>
                )}
            </div>

            {done.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {done.map(d => (
                        <div
                            key={d.id}
                            style={{
                                padding: '1rem 1.25rem', borderRadius: '12px', fontSize: '1.15rem', fontWeight: 600,
                                color: 'var(--success)',
                                background: 'color-mix(in srgb, var(--success) 12%, transparent)',
                                border: '1px solid color-mix(in srgb, var(--success) 35%, transparent)'
                            }}
                        >
                            ✓ {d.name} — {d.qty} repuesto{d.qty === 1 ? '' : 's'}
                        </div>
                    ))}
                </div>
            )}

            {!selected ? (
                <div className="glass-panel" style={{ padding: '3rem 2rem', textAlign: 'center' }}>
                    <p style={{ margin: 0, fontSize: '1.3rem', color: 'var(--text-secondary)' }}>
                        Selecciona tu nombre para empezar
                    </p>
                </div>
            ) : loadError ? (
                <p style={{ color: 'var(--danger)', fontSize: '1.15rem' }}>Error al cargar: {loadError}</p>
            ) : isLoading ? (
                <p style={{ color: 'var(--text-secondary)', fontSize: '1.15rem' }}>Cargando...</p>
            ) : pending.length === 0 ? (
                <div className="glass-panel" style={{ padding: '3rem 2rem', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ background: 'var(--bg-secondary)', padding: '1.5rem', borderRadius: '50%', display: 'flex' }}>
                        <Package size={48} color="var(--success)" />
                    </div>
                    <p style={{ margin: 0, fontSize: '1.3rem', color: 'var(--text-secondary)' }}>
                        Todo está completo. No hay nada que reponer.
                    </p>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                    {[...grouped.entries()].map(([groupName, groupRows]) => (
                        <div key={groupName} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700, color: 'var(--accent-primary)' }}>
                                {groupName}
                            </h2>

                            {groupRows.map(row => {
                                const suggested = suggestedFor(row);
                                const isBusy = busyId === row.id;
                                const err = rowErrors[row.id];
                                const isCustomOpen = customOpen[row.id] === true;

                                return (
                                    <div
                                        key={row.id}
                                        className="glass-panel"
                                        style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                                            <div style={{ flex: 1, minWidth: '200px' }}>
                                                <div style={{ fontSize: '1.5rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                                                    {row.name}
                                                </div>
                                                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent-primary)', marginTop: '0.3rem' }}>
                                                    Sacar: {suggested}
                                                </div>
                                            </div>

                                            <button
                                                onClick={() => handleRestock(row, suggested)}
                                                disabled={isBusy}
                                                className="btn-primary"
                                                style={{
                                                    borderRadius: '10px', padding: '1rem 2rem', minHeight: '72px',
                                                    fontSize: '1.25rem', fontWeight: 700,
                                                    opacity: isBusy ? 0.5 : 1,
                                                    cursor: isBusy ? 'not-allowed' : 'pointer'
                                                }}
                                            >
                                                {isBusy ? 'Enviando...' : 'Repuesto'}
                                            </button>
                                        </div>

                                        {!isCustomOpen && (
                                            <button
                                                onClick={() => {
                                                    setCustomOpen(prev => ({ ...prev, [row.id]: true }));
                                                    setCustomQty(prev => ({ ...prev, [row.id]: String(suggested) }));
                                                }}
                                                style={{
                                                    alignSelf: 'flex-start', padding: '0.5rem 0',
                                                    fontSize: '1.05rem', color: 'var(--accent-primary)',
                                                    textDecoration: 'underline', cursor: 'pointer',
                                                    background: 'none', border: 'none'
                                                }}
                                            >
                                                Otra cantidad
                                            </button>
                                        )}

                                        {isCustomOpen && (
                                            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                                                <input
                                                    type="number"
                                                    min={1}
                                                    inputMode="numeric"
                                                    value={customQty[row.id] ?? ''}
                                                    onChange={e => setCustomQty(prev => ({ ...prev, [row.id]: e.target.value }))}
                                                    style={{
                                                        padding: '0.8rem 1rem', minHeight: '64px', fontSize: '1.25rem',
                                                        width: '130px', borderRadius: '8px',
                                                        color: 'var(--text-primary)', background: 'var(--bg-primary)',
                                                        border: '1px solid var(--border)'
                                                    }}
                                                />
                                                <button
                                                    onClick={() => handleRestock(row, Number(customQty[row.id]))}
                                                    disabled={isBusy}
                                                    className="btn-primary"
                                                    style={{
                                                        borderRadius: '10px', padding: '0.9rem 1.6rem', minHeight: '64px',
                                                        fontSize: '1.15rem', fontWeight: 700,
                                                        opacity: isBusy ? 0.5 : 1,
                                                        cursor: isBusy ? 'not-allowed' : 'pointer'
                                                    }}
                                                >
                                                    {isBusy ? 'Enviando...' : 'Confirmar'}
                                                </button>
                                                <button
                                                    onClick={() => setCustomOpen(prev => ({ ...prev, [row.id]: false }))}
                                                    disabled={isBusy}
                                                    style={{
                                                        padding: '0.9rem 1.4rem', minHeight: '64px', fontSize: '1.15rem',
                                                        borderRadius: '10px', color: 'var(--text-secondary)',
                                                        background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)',
                                                        cursor: isBusy ? 'not-allowed' : 'pointer'
                                                    }}
                                                >
                                                    Cancelar
                                                </button>
                                            </div>
                                        )}

                                        {err && (
                                            <div style={{
                                                padding: '1rem', borderRadius: '8px', fontSize: '1.1rem',
                                                color: 'var(--danger)',
                                                background: 'color-mix(in srgb, var(--danger) 10%, transparent)',
                                                border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)'
                                            }}>
                                                {err}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function AperturaPlaceholder() {
    return (
        <div className="glass-panel" style={{ padding: '3rem 2rem', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
            <div style={{ background: 'var(--bg-secondary)', padding: '1.5rem', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <LayoutDashboard size={48} color="var(--accent-secondary)" />
            </div>
            <h3 style={{ fontSize: '1.5rem', margin: 0, color: 'var(--text-primary)' }}>En construcción</h3>
            <p style={{ color: 'var(--text-secondary)', maxWidth: '420px', fontSize: '1.1rem', margin: 0 }}>
                Las tareas de apertura estarán disponibles pronto.
            </p>
        </div>
    );
}

export default function ClosingListsPage() {
    // Read now so admin-only controls can be added later without restructuring.
    const { isAdmin } = useAdmin();
    const locale = useLocale();
    const [activeTab, setActiveTab] = useState<'APERTURA' | 'CIERRE'>('CIERRE');

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', maxWidth: '900px', margin: '0 auto', padding: '1.5rem' }}>

            <div>
                <h1 style={{ fontSize: '2.5rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>
                    {locale === 'es' ? 'Listas de Apertura y Cierre' : 'Opening & Closing Lists'}
                </h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem' }}>
                    Tareas de apertura y reposición de cierre.
                </p>
            </div>

            {/* Controls Container */}
            <div className="glass-panel" style={{ padding: '1rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>

                {/* Tabs */}
                <div style={{ display: 'flex', gap: '0.5rem', background: 'rgba(0,0,0,0.2)', padding: '0.3rem', borderRadius: '12px' }}>
                    {[
                        { id: 'APERTURA', label: 'Apertura' },
                        { id: 'CIERRE', label: 'Cierre' }
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as any)}
                            style={{
                                padding: '0.8rem 1.6rem',
                                borderRadius: '8px',
                                fontWeight: 500,
                                fontSize: '1.1rem',
                                minHeight: '56px',
                                color: activeTab === tab.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                                background: activeTab === tab.id ? 'var(--bg-primary)' : 'transparent',
                                transition: 'all 0.2s',
                                border: activeTab === tab.id ? '1px solid rgba(255,255,255,0.1)' : '1px solid transparent',
                                boxShadow: activeTab === tab.id ? '0 4px 12px rgba(0,0,0,0.1)' : 'none'
                            }}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {activeTab === 'APERTURA' && <AperturaPlaceholder />}
            {activeTab === 'CIERRE' && <RestockView />}
        </div>
    );
}
