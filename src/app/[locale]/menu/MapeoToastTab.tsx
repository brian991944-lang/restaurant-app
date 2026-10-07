'use client';

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { getToastMappings, seedToastMappings, setToastMapping, type PosMappingRow } from '@/app/actions/posMapping';

const ORIGEN: Record<string, string> = {
    NAME: 'Por nombre',
    NAME_GF: 'Por nombre (GF)',
    MANUAL: 'Manual',
    NONE: 'Sin vincular'
};

/**
 * Which app dish or modifier each Toast item stands for. Unlinked rows come
 * first, in amber; choosing a target saves it as MANUAL, which a re-sync never
 * overwrites. Read-only toward Toast.
 */
export default function MapeoToastTab() {
    const [rows, setRows] = useState<PosMappingRow[]>([]);
    const [menuItems, setMenuItems] = useState<{ id: string; name: string }[]>([]);
    const [modifiers, setModifiers] = useState<{ id: string; label: string }[]>([]);
    const [loading, setLoading] = useState(true);
    const [seeding, setSeeding] = useState(false);
    const [savingId, setSavingId] = useState<string | null>(null);
    const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

    const load = async () => {
        const res = await getToastMappings();
        setRows(res.rows);
        setMenuItems(res.menuItems);
        setModifiers(res.modifiers);
        if (res.error) setMessage({ text: res.error, error: true });
        setLoading(false);
    };

    useEffect(() => { load(); }, []);

    const handleSeed = async () => {
        setSeeding(true);
        setMessage(null);
        try {
            const res = await seedToastMappings();
            if (!res.success || !res.report) {
                setMessage({ text: res.error ?? 'No se pudo sincronizar el mapeo.', error: true });
                return;
            }
            const r = res.report;
            const sinVincular = r.items.filter(i => i.matchedBy === 'NONE').length + r.modifiers.filter(m => m.matchedBy === 'NONE').length;
            setMessage({
                text: `Mapeo actualizado: ${r.items.length} platos, ${r.modifiers.length} modificadores, ${sinVincular} sin vincular, ${r.keptManual} manuales conservados.`,
                error: false
            });
            await load();
        } catch (e) {
            setMessage({ text: e instanceof Error ? e.message : 'No se pudo sincronizar el mapeo.', error: true });
        } finally {
            setSeeding(false);
        }
    };

    const handleAssign = async (row: PosMappingRow, targetId: string) => {
        setSavingId(row.id);
        setMessage(null);
        try {
            const res = await setToastMapping(row.id, targetId || null);
            if (!res.success) {
                setMessage({ text: res.error ?? 'No se pudo guardar el mapeo.', error: true });
                return;
            }
            await load();
        } finally {
            setSavingId(null);
        }
    };

    // Unlinked first, then items before modifiers, then by name.
    const sorted = [...rows].sort((a, b) =>
        Number(a.matchedBy !== 'NONE') - Number(b.matchedBy !== 'NONE') ||
        a.kind.localeCompare(b.kind) ||
        a.posDisplayName.localeCompare(b.posDisplayName)
    );
    const unlinked = rows.filter(r => r.matchedBy === 'NONE').length;

    const selectStyle: React.CSSProperties = {
        width: '100%', minHeight: '52px', padding: '0 0.75rem', borderRadius: '8px',
        fontSize: '1rem', color: 'var(--text-primary)', background: 'var(--bg-primary)',
        border: '1px solid var(--border)'
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: '1.5rem' }}>Mapeo Toast</h2>
                    <p style={{ margin: '0.25rem 0 0 0', color: 'var(--text-secondary)' }}>
                        Qué plato o modificador de la app es cada artículo de Toast. Solo se descuenta inventario de lo vinculado.
                        {rows.length > 0 && <> {unlinked} sin vincular de {rows.length}.</>}
                    </p>
                </div>
                <button
                    onClick={handleSeed}
                    disabled={seeding}
                    style={{
                        display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                        minHeight: '52px', padding: '0 1.25rem', borderRadius: '8px',
                        fontSize: '1rem', fontWeight: 600, cursor: seeding ? 'not-allowed' : 'pointer',
                        color: 'white', background: 'var(--accent-primary)', border: '1px solid var(--accent-primary)',
                        opacity: seeding ? 0.6 : 1
                    }}
                >
                    <RefreshCw size={18} />
                    {seeding ? 'Sincronizando…' : 'Volver a sincronizar mapeo'}
                </button>
            </div>

            {message && (
                <p style={{ margin: 0, fontSize: '1rem', color: message.error ? 'var(--danger)' : 'var(--text-secondary)' }}>{message.text}</p>
            )}

            {loading ? (
                <p style={{ color: 'var(--text-secondary)' }}>Cargando…</p>
            ) : rows.length === 0 ? (
                <p style={{ color: 'var(--text-secondary)' }}>Todavía no hay mapeo. Usa “Volver a sincronizar mapeo”.</p>
            ) : (
                <div className="glass-panel" style={{ padding: 0, overflowX: 'auto' }}>
                    {/* Below ~720px the table scrolls sideways inside this panel, not the page. */}
                    <div style={{
                        display: 'grid', gridTemplateColumns: 'minmax(180px, 2fr) 120px minmax(220px, 3fr) 150px',
                        gap: '0.75rem', padding: '0.9rem 1rem', fontSize: '0.95rem', fontWeight: 600,
                        color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)'
                    }}>
                        <span>Nombre en Toast</span>
                        <span>Tipo</span>
                        <span>Plato / Modificador en la app</span>
                        <span>Origen del match</span>
                    </div>
                    {sorted.map(row => {
                        const isNone = row.matchedBy === 'NONE';
                        const isItem = row.kind === 'ITEM';
                        const value = (isItem ? row.menuItemId : row.menuItemModifierId) ?? '';
                        return (
                            <div
                                key={row.id}
                                style={{
                                    display: 'grid', gridTemplateColumns: 'minmax(180px, 2fr) 120px minmax(220px, 3fr) 150px',
                                    gap: '0.75rem', alignItems: 'center', padding: '0.75rem 1rem',
                                    borderBottom: '1px solid var(--border)',
                                    borderLeft: `4px solid ${isNone ? 'var(--warning)' : 'transparent'}`,
                                    background: isNone ? 'color-mix(in srgb, var(--warning) 10%, transparent)' : 'transparent'
                                }}
                            >
                                <span style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>
                                    {row.posDisplayName}
                                </span>
                                <span style={{ color: 'var(--text-secondary)' }}>{isItem ? 'Plato' : 'Modificador'}</span>
                                <select
                                    value={value}
                                    disabled={savingId === row.id}
                                    onChange={e => handleAssign(row, e.target.value)}
                                    style={selectStyle}
                                >
                                    <option value="">— Sin vincular —</option>
                                    {isItem
                                        ? menuItems.map(m => <option key={m.id} value={m.id}>{m.name}</option>)
                                        : modifiers.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                                </select>
                                <span style={{ fontWeight: 600, color: isNone ? 'var(--warning)' : 'var(--text-secondary)' }}>
                                    {savingId === row.id ? 'Guardando…' : ORIGEN[row.matchedBy] ?? row.matchedBy}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
