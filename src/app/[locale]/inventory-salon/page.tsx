'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
import { ChevronDown, ChevronRight, Download, RefreshCw, Package, Pencil } from 'lucide-react';
import { useAdmin } from '@/components/AdminContext';
import { fetchCloverItemsForSalon, importSalonDrinksFromClover, pushSalonItemToClover, syncSalonFromClover } from '@/app/actions/clover';
import { getSalonStock, updateSalonStock } from '@/app/actions/inventory';

type CloverResult = Awaited<ReturnType<typeof fetchCloverItemsForSalon>>;
type CloverItem = CloverResult['items'][number];
type SalonRow = Awaited<ReturnType<typeof getSalonStock>>[number];
type ImportResult = Awaited<ReturnType<typeof importSalonDrinksFromClover>>;
type PushResult = Awaited<ReturnType<typeof pushSalonItemToClover>>;
type SyncResult = Awaited<ReturnType<typeof syncSalonFromClover>>;

const NO_GROUP = 'Sin grupo';

interface Draft {
    name: string;
    salonGroup: string;
    qtyBodega: string;
    qtyFront: string;
    parFront: string;
    priceDollars: string;
    autoManage: boolean;
}

// Clover sends prices as integer cents; every price on this page goes through here.
const money = (cents: number | null | undefined) =>
    typeof cents === 'number' ? `$${(cents / 100).toFixed(2)}` : '—';

const num = (value: number | null | undefined) =>
    typeof value === 'number' ? String(value) : '—';

// Tap-target sized for tablet use.
const inputStyle: React.CSSProperties = {
    padding: '0.7rem 0.9rem',
    minHeight: '52px',
    fontSize: '1.05rem',
    borderRadius: '8px',
    color: 'var(--text-primary)',
    background: 'var(--bg-primary)',
    border: '1px solid var(--border)',
    width: '100%'
};

function Field({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
    return (
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', flex: wide ? '1 1 240px' : '0 1 130px' }}>
            <span style={{ fontSize: '0.95rem', color: 'var(--text-secondary)', fontWeight: 500 }}>{label}</span>
            {children}
        </label>
    );
}

// Left-hand group label, spanning all of its group's rows.
const groupCellStyle: React.CSSProperties = {
    padding: '1rem 1.25rem',
    fontSize: '1.1rem',
    fontWeight: 700,
    color: 'var(--accent-primary)',
    verticalAlign: 'middle',
    whiteSpace: 'nowrap',
    borderRight: '1px solid var(--border)',
    background: 'rgba(255,255,255,0.02)'
};

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

function AdminSalonView() {
    const { isAdmin } = useAdmin();
    const [isImportOpen, setIsImportOpen] = useState(false);

    const [editingId, setEditingId] = useState<string | null>(null);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [editError, setEditError] = useState<string | null>(null);

    const [pushResults, setPushResults] = useState<Record<string, PushResult>>({});

    const [isSyncConfirmOpen, setIsSyncConfirmOpen] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
    const [syncError, setSyncError] = useState<string | null>(null);

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

    const startEdit = (row: SalonRow) => {
        const stock = row.salonStock;
        setEditingId(row.id);
        setEditError(null);
        setDraft({
            name: row.name,
            // Blank rather than "Sin grupo": that label is a display placeholder,
            // not a value to write back to the database.
            salonGroup: stock?.salonGroup ?? '',
            qtyBodega: String(stock?.qtyBodega ?? 0),
            qtyFront: String(stock?.qtyFront ?? 0),
            parFront: String(stock?.parFront ?? 0),
            priceDollars: ((stock?.salePrice ?? 0) / 100).toFixed(2),
            autoManage: stock?.autoManage ?? true
        });
    };

    const cancelEdit = () => {
        setEditingId(null);
        setDraft(null);
        setEditError(null);
    };

    const handleSave = async () => {
        if (!editingId || !draft) return;

        const name = draft.name.trim();
        if (!name) {
            setEditError('El nombre no puede estar vacío.');
            return;
        }

        const counts: [string, string][] = [
            ['Bodega', draft.qtyBodega],
            ['Front', draft.qtyFront],
            ['Par', draft.parFront]
        ];
        const parsed: Record<string, number> = {};
        for (const [label, raw] of counts) {
            const value = Number(raw);
            if (raw.trim() === '' || !Number.isFinite(value)) {
                setEditError(`El valor de ${label} no es un número válido.`);
                return;
            }
            if (value < 0) {
                setEditError(`El valor de ${label} no puede ser negativo.`);
                return;
            }
            parsed[label] = Math.round(value);
        }

        const dollars = Number(draft.priceDollars.replace(/\$/g, '').trim());
        if (!Number.isFinite(dollars) || dollars < 0) {
            setEditError('El precio no es válido.');
            return;
        }

        setIsSaving(true);
        setEditError(null);
        try {
            const result = await updateSalonStock(editingId, {
                name,
                qtyBodega: parsed['Bodega'],
                qtyFront: parsed['Front'],
                parFront: parsed['Par'],
                salePrice: Math.round(dollars * 100),
                autoManage: draft.autoManage,
                // Omitted when blank so the column default stands rather than
                // storing an empty group name.
                ...(draft.salonGroup.trim() ? { salonGroup: draft.salonGroup.trim() } : {})
            });
            if (!result.success) {
                // The push is deliberately not attempted when the save fails —
                // Clover must never receive values the database rejected.
                setEditError(result.error ?? 'Error al guardar los cambios.');
                return;
            }

            const savedId = editingId;
            try {
                const push = await pushSalonItemToClover(savedId);
                setPushResults(prev => ({ ...prev, [savedId]: push }));
            } catch (e) {
                setPushResults(prev => ({
                    ...prev,
                    [savedId]: {
                        success: false,
                        error: e instanceof Error ? e.message : String(e),
                        echo: null
                    }
                }));
            }

            cancelEdit();
            await loadSalon();
        } catch (e) {
            setEditError(e instanceof Error ? e.message : String(e));
        } finally {
            setIsSaving(false);
        }
    };

    const handleConfirmSync = async () => {
        setIsSyncing(true);
        setSyncError(null);
        setSyncResult(null);
        try {
            const result = await syncSalonFromClover();
            setSyncResult(result);
            setIsSyncConfirmOpen(false);
            await loadSalon();
        } catch (e) {
            setSyncError(e instanceof Error ? e.message : String(e));
            setIsSyncConfirmOpen(false);
        } finally {
            setIsSyncing(false);
        }
    };

    const drinks = (clover?.items ?? []).filter(i => i.categoryName === 'Drinks');
    const linkedIds = new Set(clover?.alreadyLinked ?? []);

    // Rows bucketed by salonGroup; a missing stock row falls into "Sin grupo".
    const grouped = new Map<string, SalonRow[]>();
    for (const row of salonRows) {
        const key = row.salonStock?.salonGroup || NO_GROUP;
        const bucket = grouped.get(key);
        if (bucket) bucket.push(row);
        else grouped.set(key, [row]);
    }
    const groupNames = [...grouped.keys()].sort((a, b) => a.localeCompare(b, 'es'));
    const columnCount = isAdmin ? 8 : 7;

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
            </div>

            {/* SECTION A — Importar desde Clover */}
            <div className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                    <button
                        onClick={handleToggleImport}
                        className="btn-primary"
                        style={{
                            display: 'flex', alignItems: 'center', gap: '0.75rem',
                            borderRadius: '8px', padding: '0.9rem 1.4rem', minHeight: '56px',
                            fontSize: '1.1rem', fontWeight: 600
                        }}
                    >
                        {isImportOpen ? <ChevronDown size={22} /> : <ChevronRight size={22} />}
                        <Download size={20} />
                        <span>Importar desde Clover</span>
                    </button>

                    {isAdmin && (
                        <button
                            onClick={() => setIsSyncConfirmOpen(true)}
                            disabled={isSyncing}
                            className="btn-secondary"
                            style={{
                                display: 'flex', alignItems: 'center', gap: '0.75rem',
                                borderRadius: '8px', padding: '0.9rem 1.4rem', minHeight: '56px',
                                fontSize: '1.1rem', fontWeight: 600,
                                background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)',
                                opacity: isSyncing ? 0.5 : 1,
                                cursor: isSyncing ? 'not-allowed' : 'pointer'
                            }}
                        >
                            <RefreshCw size={20} className={isSyncing ? 'spin-anim' : ''} />
                            <span>{isSyncing ? 'Sincronizando...' : 'Sincronizar con Clover'}</span>
                        </button>
                    )}
                </div>

                {syncError && (
                    <p style={{ color: 'var(--danger)', fontSize: '1.05rem', margin: 0 }}>
                        Error al sincronizar: {syncError}
                    </p>
                )}

                {syncResult && (
                    <div style={{ padding: '1.25rem', borderRadius: '12px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <p style={{ margin: 0, fontSize: '1.1rem', color: 'var(--success)', fontWeight: 600 }}>
                            Sincronizados: {syncResult.updated}
                        </p>
                        {syncResult.skipped.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                                <p style={{ margin: 0, fontSize: '1rem', color: 'var(--warning)', fontWeight: 600 }}>
                                    Avisos: {syncResult.skipped.length}
                                </p>
                                {syncResult.skipped.map((s, i) => (
                                    <p key={`${s.name}-${i}`} style={{ margin: 0, fontSize: '1rem', color: 'var(--text-secondary)' }}>
                                        {s.name} — {s.reason}
                                    </p>
                                ))}
                            </div>
                        )}
                    </div>
                )}

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
                                    <th style={headStyle} />
                                    <th style={headStyle}>Nombre</th>
                                    <th style={{ ...headStyle, textAlign: 'center' }}>Bodega</th>
                                    <th style={{ ...headStyle, textAlign: 'center' }}>Front</th>
                                    <th style={{ ...headStyle, textAlign: 'center' }}>Total</th>
                                    <th style={{ ...headStyle, textAlign: 'center' }}>Par</th>
                                    <th style={{ ...headStyle, textAlign: 'right' }}>Precio</th>
                                    <th style={{ ...headStyle, textAlign: 'center' }}>Stock</th>
                                    {isAdmin && <th style={{ ...headStyle, textAlign: 'right' }}>Acciones</th>}
                                </tr>
                            </thead>
                            <tbody>
                                {groupNames.map(groupName => {
                                    const rows = [...(grouped.get(groupName) ?? [])]
                                        .sort((a, b) => a.name.localeCompare(b.name, 'es'));

                                    // The group cell spans every <tr> the group emits, which is one
                                    // per item plus one more wherever a push result is showing.
                                    const trCount = rows.reduce(
                                        (n, r) => n + ((editingId === r.id && draft) ? 1 : (pushResults[r.id] ? 2 : 1)),
                                        0
                                    );

                                    return (
                                        <Fragment key={groupName}>
                                            {rows.map((row, index) => {
                                                const stock = row.salonStock;
                                                const total = stock ? stock.qtyBodega + stock.qtyFront : null;

                                                if (isAdmin && editingId === row.id && draft) {
                                                    return (
                                                        <tr key={row.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                                            {index === 0 && <td rowSpan={trCount} style={groupCellStyle}>{groupName}</td>}
                                                            <td colSpan={columnCount} style={{ padding: '1.25rem' }}>
                                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                                                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                                                                        <Field label="Nombre" wide>
                                                                            <input
                                                                                type="text"
                                                                                value={draft.name}
                                                                                onChange={e => setDraft({ ...draft, name: e.target.value })}
                                                                                style={inputStyle}
                                                                            />
                                                                        </Field>
                                                                        <Field label="Grupo" wide>
                                                                            <input
                                                                                type="text"
                                                                                value={draft.salonGroup}
                                                                                onChange={e => setDraft({ ...draft, salonGroup: e.target.value })}
                                                                                placeholder="Escribe un grupo nuevo si hace falta"
                                                                                style={inputStyle}
                                                                            />
                                                                        </Field>
                                                                        <Field label="Bodega">
                                                                            <input
                                                                                type="number"
                                                                                min={0}
                                                                                value={draft.qtyBodega}
                                                                                onChange={e => setDraft({ ...draft, qtyBodega: e.target.value })}
                                                                                style={inputStyle}
                                                                            />
                                                                        </Field>
                                                                        <Field label="Front">
                                                                            <input
                                                                                type="number"
                                                                                min={0}
                                                                                value={draft.qtyFront}
                                                                                onChange={e => setDraft({ ...draft, qtyFront: e.target.value })}
                                                                                style={inputStyle}
                                                                            />
                                                                        </Field>
                                                                        <Field label="Par">
                                                                            <input
                                                                                type="number"
                                                                                min={0}
                                                                                value={draft.parFront}
                                                                                onChange={e => setDraft({ ...draft, parFront: e.target.value })}
                                                                                style={inputStyle}
                                                                            />
                                                                        </Field>
                                                                        <Field label="Precio ($)">
                                                                            <input
                                                                                type="text"
                                                                                inputMode="decimal"
                                                                                value={draft.priceDollars}
                                                                                onChange={e => setDraft({ ...draft, priceDollars: e.target.value })}
                                                                                style={inputStyle}
                                                                            />
                                                                        </Field>
                                                                        <Field label="Control de stock" wide>
                                                                            <select
                                                                                value={draft.autoManage ? 'auto' : 'manual'}
                                                                                onChange={e => setDraft({ ...draft, autoManage: e.target.value === 'auto' })}
                                                                                style={{ ...inputStyle, cursor: 'pointer' }}
                                                                            >
                                                                                <option value="auto">Automático</option>
                                                                                <option value="manual">Manual</option>
                                                                            </select>
                                                                        </Field>
                                                                    </div>

                                                                    <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
                                                                        Automático: Clover descuenta el stock en cada venta y desactiva el producto al llegar a 0.
                                                                    </p>

                                                                    {editError && (
                                                                        <p style={{ margin: 0, color: 'var(--danger)', fontSize: '1.05rem' }}>{editError}</p>
                                                                    )}

                                                                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                                                                        <button
                                                                            onClick={handleSave}
                                                                            disabled={isSaving}
                                                                            className="btn-primary"
                                                                            style={{
                                                                                borderRadius: '8px', padding: '0.8rem 1.5rem', minHeight: '52px',
                                                                                fontSize: '1.05rem', fontWeight: 600,
                                                                                opacity: isSaving ? 0.5 : 1,
                                                                                cursor: isSaving ? 'not-allowed' : 'pointer'
                                                                            }}
                                                                        >
                                                                            {isSaving ? 'Guardando...' : 'Guardar y enviar a Clover'}
                                                                        </button>
                                                                        <button
                                                                            onClick={cancelEdit}
                                                                            disabled={isSaving}
                                                                            className="btn-secondary"
                                                                            style={{
                                                                                borderRadius: '8px', padding: '0.8rem 1.5rem', minHeight: '52px',
                                                                                fontSize: '1.05rem', fontWeight: 600,
                                                                                background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)',
                                                                                cursor: isSaving ? 'not-allowed' : 'pointer'
                                                                            }}
                                                                        >
                                                                            Cancelar
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    );
                                                }

                                                const pushed = pushResults[row.id];

                                                return (
                                                    <Fragment key={row.id}>
                                                    <tr style={{ borderBottom: pushed ? 'none' : '1px solid var(--border)' }}>
                                                        {index === 0 && <td rowSpan={trCount} style={groupCellStyle}>{groupName}</td>}
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
                                                        <td style={{ ...cellStyle, textAlign: 'center' }}>
                                                            {!stock
                                                                ? '—'
                                                                : stock.autoManage
                                                                    ? <span style={{ color: 'var(--text-secondary)' }}>Automático</span>
                                                                    : <Badge label="Manual" tone="warning" />}
                                                        </td>
                                                        {isAdmin && (
                                                            <td style={{ ...cellStyle, textAlign: 'right' }}>
                                                                <button
                                                                    onClick={() => startEdit(row)}
                                                                    className="btn-secondary"
                                                                    style={{
                                                                        display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
                                                                        borderRadius: '8px', padding: '0.7rem 1.1rem', minHeight: '48px',
                                                                        fontSize: '1rem', fontWeight: 500,
                                                                        background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)',
                                                                        cursor: 'pointer'
                                                                    }}
                                                                >
                                                                    <Pencil size={18} />
                                                                    <span>Editar</span>
                                                                </button>
                                                            </td>
                                                        )}
                                                    </tr>

                                                    {pushed && (
                                                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                                            <td colSpan={columnCount} style={{ padding: '0 1.25rem 1.25rem 1.25rem' }}>
                                                                {pushed.success && pushed.echo ? (
                                                                    <div style={{ padding: '1rem', borderRadius: '8px', background: 'color-mix(in srgb, var(--success) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--success) 30%, transparent)' }}>
                                                                        <p style={{ margin: '0 0 0.4rem 0', color: 'var(--success)', fontWeight: 600, fontSize: '1.05rem' }}>
                                                                            Clover confirmó:
                                                                        </p>
                                                                        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '1rem' }}>
                                                                            Nombre: {pushed.echo.name} · Precio: {money(pushed.echo.price)} · Stock: {num(pushed.echo.stockCount)}
                                                                            {' · '}Disponible: {pushed.echo.available ? 'Sí' : 'No'}
                                                                            {' · '}Auto-stock: {pushed.echo.autoManage ? 'Sí' : 'No'}
                                                                        </p>
                                                                    </div>
                                                                ) : (
                                                                    <div style={{ padding: '1rem', borderRadius: '8px', background: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)' }}>
                                                                        <p style={{ margin: 0, color: 'var(--danger)', fontSize: '1.05rem' }}>
                                                                            {pushed.error ?? 'Error desconocido al enviar a Clover.'}
                                                                        </p>
                                                                    </div>
                                                                )}
                                                            </td>
                                                        </tr>
                                                    )}
                                                    </Fragment>
                                                );
                                            })}
                                        </Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Confirmación de sincronización desde Clover */}
            {isAdmin && isSyncConfirmOpen && (
                <div
                    onClick={() => { if (!isSyncing) setIsSyncConfirmOpen(false); }}
                    style={{
                        position: 'fixed', inset: 0, zIndex: 1000,
                        background: 'rgba(0,0,0,0.5)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        padding: '1.5rem'
                    }}
                >
                    <div
                        onClick={e => e.stopPropagation()}
                        className="glass-panel"
                        style={{ padding: '2rem', maxWidth: '560px', width: '100%', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}
                    >
                        <h3 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                            Sincronizar con Clover
                        </h3>

                        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '1.05rem' }}>
                            Se traerán los datos de Clover para todos los productos del salón que estén vinculados.
                        </p>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', padding: '1rem', borderRadius: '8px', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)' }}>
                            <span style={{ fontSize: '1.05rem', color: 'var(--warning)', fontWeight: 600 }}>
                                Se sobrescribirán con los valores de Clover:
                            </span>
                            <span style={{ fontSize: '1.05rem', color: 'var(--text-primary)' }}>
                                Nombre, cantidad de Front y Precio
                            </span>
                            <span style={{ fontSize: '1.05rem', color: 'var(--success)', fontWeight: 600, marginTop: '0.4rem' }}>
                                No se modificarán:
                            </span>
                            <span style={{ fontSize: '1.05rem', color: 'var(--text-primary)' }}>
                                Bodega, Par, Unidades por paquete y Grupo
                            </span>
                        </div>

                        <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
                            Si Clover no reporta una cantidad para un producto, su Front se deja como está.
                        </p>

                        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                            <button
                                onClick={handleConfirmSync}
                                disabled={isSyncing}
                                className="btn-primary"
                                style={{
                                    borderRadius: '8px', padding: '0.9rem 1.6rem', minHeight: '56px',
                                    fontSize: '1.1rem', fontWeight: 600,
                                    opacity: isSyncing ? 0.5 : 1,
                                    cursor: isSyncing ? 'not-allowed' : 'pointer'
                                }}
                            >
                                {isSyncing ? 'Sincronizando...' : 'Confirmar'}
                            </button>
                            <button
                                onClick={() => setIsSyncConfirmOpen(false)}
                                disabled={isSyncing}
                                className="btn-secondary"
                                style={{
                                    borderRadius: '8px', padding: '0.9rem 1.6rem', minHeight: '56px',
                                    fontSize: '1.1rem', fontWeight: 600,
                                    background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)',
                                    cursor: isSyncing ? 'not-allowed' : 'pointer'
                                }}
                            >
                                Cancelar
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}

/**
 * Read-only salón stock for non-admins: what is on hand, nothing more. No
 * prices, par levels, stock-control state, or any action.
 */
function WorkerSalonTable() {
    const [rows, setRows] = useState<SalonRow[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        getSalonStock()
            .then(r => { if (!cancelled) setRows(r); })
            .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
            .finally(() => { if (!cancelled) setIsLoading(false); });
        return () => { cancelled = true; };
    }, []);

    const grouped = new Map<string, SalonRow[]>();
    for (const row of rows) {
        const key = row.salonStock?.salonGroup || NO_GROUP;
        const bucket = grouped.get(key);
        if (bucket) bucket.push(row);
        else grouped.set(key, [row]);
    }
    const groupNames = [...grouped.keys()].sort((a, b) => a.localeCompare(b, 'es'));

    const cellStyle = { padding: '1rem 1.25rem', fontSize: '1.05rem' };
    const headStyle = { padding: '1rem 1.25rem', fontWeight: 500, fontSize: '0.95rem' };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', maxWidth: '1200px', margin: '0 auto', padding: '2rem' }}>
            <div>
                <h1 style={{ fontSize: '2.5rem', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Inventario Salón</h1>
                <p style={{ color: 'var(--text-secondary)' }}>Productos del salón y su stock actual.</p>
            </div>

            {error && (
                <p style={{ color: 'var(--danger)', fontSize: '1.05rem' }}>Error al cargar el inventario: {error}</p>
            )}

            {isLoading && !error && (
                <p style={{ color: 'var(--text-secondary)', fontSize: '1.05rem' }}>Cargando productos...</p>
            )}

            {!isLoading && !error && rows.length === 0 && (
                <div className="glass-panel" style={{ padding: '3rem', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ background: 'var(--bg-secondary)', padding: '1.5rem', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Package size={48} color="var(--accent-secondary)" />
                    </div>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '1.1rem', margin: 0 }}>No hay productos en el salón todavía.</p>
                </div>
            )}

            {!isLoading && !error && rows.length > 0 && (
                <div className="glass-panel" style={{ padding: '0', overflowX: 'auto' }}>
                    <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse', minWidth: '520px' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                                <th style={headStyle} />
                                <th style={headStyle}>Nombre</th>
                                <th style={{ ...headStyle, textAlign: 'center' }}>Bodega</th>
                                <th style={{ ...headStyle, textAlign: 'center' }}>Front</th>
                                <th style={{ ...headStyle, textAlign: 'center' }}>Total</th>
                            </tr>
                        </thead>
                        <tbody>
                            {groupNames.map(groupName => {
                                const groupRows = [...(grouped.get(groupName) ?? [])]
                                    .sort((a, b) => a.name.localeCompare(b.name, 'es'));

                                return (
                                    <Fragment key={groupName}>
                                        {groupRows.map((row, index) => {
                                            const stock = row.salonStock;
                                            const total = stock ? stock.qtyBodega + stock.qtyFront : null;
                                            return (
                                                <tr key={row.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                                    {index === 0 && <td rowSpan={groupRows.length} style={groupCellStyle}>{groupName}</td>}
                                                    <td style={{ ...cellStyle, fontWeight: 500, color: 'var(--text-primary)' }}>{row.name}</td>
                                                    <td style={{ ...cellStyle, textAlign: 'center' }}>{num(stock?.qtyBodega)}</td>
                                                    <td style={{ ...cellStyle, textAlign: 'center' }}>{num(stock?.qtyFront)}</td>
                                                    <td style={{ ...cellStyle, textAlign: 'center', fontWeight: 700 }}>{num(total)}</td>
                                                </tr>
                                            );
                                        })}
                                    </Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

export default function InventorySalonPage() {
    const { isAdmin } = useAdmin();
    return isAdmin ? <AdminSalonView /> : <WorkerSalonTable />;
}
