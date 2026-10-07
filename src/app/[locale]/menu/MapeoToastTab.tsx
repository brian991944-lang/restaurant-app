'use client';

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { getToastMappings, seedToastMappings, setToastMapping, type PosMappingRow } from '@/app/actions/posMapping';
import { getToastBaseline, previewToastBaseline, setToastBaseline, type BaselineSummary } from '@/app/actions/toastSales';

const NY = 'America/New_York';

/** Now in New York as the 'YYYY-MM-DDTHH:mm' a datetime-local input takes. */
function nowInNewYork(): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: NY, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(new Date());
    const get = (t: string) => parts.find(p => p.type === t)?.value ?? '00';
    return `${get('year')}-${get('month')}-${get('day')}T${String(Number(get('hour')) % 24).padStart(2, '0')}:${get('minute')}`;
}

const showNy = (iso: string) => new Date(iso).toLocaleString('es', { timeZone: NY, dateStyle: 'medium', timeStyle: 'short' });

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

    // Counting point: preview first, then confirm.
    const [baseline, setBaseline] = useState<string | null>(null);
    // Filled after mount: "now" on the server would not match the browser's.
    const [baselineInput, setBaselineInput] = useState('');
    useEffect(() => { setBaselineInput(nowInNewYork()); }, []);
    const [preview, setPreview] = useState<BaselineSummary | null>(null);
    const [baselineBusy, setBaselineBusy] = useState(false);
    const [baselineMsg, setBaselineMsg] = useState<{ text: string; error: boolean } | null>(null);

    const handlePreview = async () => {
        setBaselineBusy(true);
        setBaselineMsg(null);
        setPreview(null);
        try {
            const res = await previewToastBaseline(baselineInput);
            if (!res.success || !res.summary) setBaselineMsg({ text: res.error ?? 'No se pudo calcular.', error: true });
            else setPreview(res.summary);
        } finally {
            setBaselineBusy(false);
        }
    };

    const handleConfirm = async () => {
        if (!preview) return;
        setBaselineBusy(true);
        setBaselineMsg(null);
        try {
            const res = await setToastBaseline(baselineInput);
            if (!res.success) {
                setBaselineMsg({ text: res.error ?? 'No se pudo fijar el punto de conteo.', error: true });
            } else {
                setBaselineMsg({ text: `Punto de conteo fijado. ${res.summary?.before ?? 0} líneas quedaron como ya contadas, sin mover inventario.`, error: false });
                setPreview(null);
            }
            setBaseline(await getToastBaseline());
        } finally {
            setBaselineBusy(false);
        }
    };

    const load = async () => {
        getToastBaseline().then(setBaseline).catch(() => null);
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

            {/* Counting point: sales before it are already in the counted stock. */}
            <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
                <div>
                    <h3 style={{ margin: 0, fontSize: '1.2rem' }}>Punto de conteo</h3>
                    <p style={{ margin: '0.25rem 0 0 0', color: 'var(--text-secondary)' }}>
                        Las ventas de Toast anteriores a este momento se dan por contadas en el inventario y nunca se descuentan.
                        {' '}{baseline ? <>Actual: <strong>{showNy(baseline)}</strong> (hora de Nueva York).</> : 'Todavía no hay punto de conteo.'}
                    </p>
                </div>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', flex: '1 1 240px' }}>
                        <span style={{ fontSize: '0.95rem', color: 'var(--text-secondary)' }}>Fecha y hora (Nueva York)</span>
                        <input
                            type="datetime-local"
                            value={baselineInput}
                            onChange={e => { setBaselineInput(e.target.value); setPreview(null); }}
                            disabled={baselineBusy}
                            style={{ ...selectStyle, padding: '0 0.75rem' }}
                        />
                    </label>
                    <button
                        onClick={handlePreview}
                        disabled={baselineBusy || !baselineInput}
                        style={{
                            minHeight: '52px', padding: '0 1.25rem', borderRadius: '8px', fontSize: '1rem', fontWeight: 600,
                            cursor: baselineBusy ? 'not-allowed' : 'pointer', color: 'var(--text-primary)',
                            background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', opacity: baselineBusy ? 0.6 : 1
                        }}
                    >
                        {baselineBusy && !preview ? 'Calculando…' : 'Fijar punto de conteo'}
                    </button>
                </div>

                {preview && (
                    <div style={{
                        display: 'flex', flexDirection: 'column', gap: '0.6rem', padding: '1rem', borderRadius: '8px',
                        border: '1px solid var(--warning)', background: 'color-mix(in srgb, var(--warning) 10%, transparent)'
                    }}>
                        <span style={{ fontWeight: 700 }}>Vista previa — {showNy(preview.baselineAt)}</span>
                        <span>
                            {preview.before} líneas de Toast quedarían como ya contadas (sin mover inventario).
                            {' '}{preview.after} líneas posteriores se descontarán cuando se active el consumo.
                        </span>
                        <span style={{ fontSize: '0.95rem', color: 'var(--text-secondary)' }}>
                            {preview.days.map(d => `${d.date}: ${d.before} antes / ${d.after} después`).join(' · ')}
                        </span>
                        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                            <button
                                onClick={handleConfirm}
                                disabled={baselineBusy}
                                style={{
                                    minHeight: '52px', padding: '0 1.25rem', borderRadius: '8px', fontSize: '1rem', fontWeight: 700,
                                    cursor: baselineBusy ? 'not-allowed' : 'pointer', color: 'white',
                                    background: 'var(--warning)', border: '1px solid var(--warning)', opacity: baselineBusy ? 0.6 : 1
                                }}
                            >
                                {baselineBusy ? 'Guardando…' : 'Confirmar punto de conteo'}
                            </button>
                            <button
                                onClick={() => setPreview(null)}
                                disabled={baselineBusy}
                                style={{
                                    minHeight: '52px', padding: '0 1.25rem', borderRadius: '8px', fontSize: '1rem', fontWeight: 600,
                                    cursor: 'pointer', color: 'var(--text-secondary)', background: 'transparent', border: '1px solid var(--border)'
                                }}
                            >
                                Cancelar
                            </button>
                        </div>
                    </div>
                )}
                {baselineMsg && (
                    <p style={{ margin: 0, color: baselineMsg.error ? 'var(--danger)' : 'var(--text-secondary)' }}>{baselineMsg.text}</p>
                )}
            </div>

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
