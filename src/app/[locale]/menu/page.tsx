'use client';

import { useEffect, useState } from 'react';
import { useAdmin } from '@/components/AdminContext';
import {
    Plus, Pencil, Trash2, ChevronUp, ChevronDown, ExternalLink,
    Image as ImageIcon, Star, Eye, EyeOff, X, RefreshCw, Ban, Tablet
} from 'lucide-react';
import {
    getMenuCategoriesAdmin, createMenuCategory, updateMenuCategory,
    reorderMenuCategories, deleteMenuCategory,
    getMenuItemsAdmin, updateMenuItem, reorderMenuItems, deleteMenuItem,
    setMenuItemSoldOut, forceMenuRepublish
} from '@/app/actions/menuAdmin';
import { syncMenuFromClover } from '@/app/actions/clover';
import { getBusinessDate } from '@/lib/businessDay';
import ItemEditorModal from './ItemEditorModal';
import CostosTab from './CostosTab';

type TabId = 'categorias' | 'platos' | 'costos';

const UNCATEGORIZED = '__none__';

// "Agotado hoy": soldOutAt counts only while it falls on the current business
// date (5 AM NY cutover). Same rule as isSoldOut in src/lib/menuSnapshot.ts,
// evaluated here on the client so the list reflects the mark expiring overnight.
const isSoldOutToday = (soldOutAt: string | Date | null | undefined): boolean =>
    !!soldOutAt && getBusinessDate(new Date(soldOutAt)) === getBusinessDate();

const PUBLISH_CONFIRM =
    '¿Actualizar todos los iPads ahora?\n\n' +
    'Cada tablet del salón descargará el menú completo (platos, fotos y videos) ' +
    'en su próxima comprobación, dentro de unos 2 minutos, aunque no sea la hora ' +
    'habitual de las 9:00 AM. Los iPads que estén sin conexión lo harán en cuanto ' +
    'vuelvan a conectarse.';

// Small status pill used in the Platos list.
const chipStyle = (color: string): React.CSSProperties => ({
    fontSize: '0.7rem',
    fontWeight: 600,
    padding: '0.1rem 0.45rem',
    borderRadius: '999px',
    color,
    border: '1px solid ' + color + '55',
    background: color + '18',
    whiteSpace: 'nowrap',
});

export default function MenuAdminPage() {
    const { isAdmin } = useAdmin();
    const [activeTab, setActiveTab] = useState<TabId>('platos');

    const [categories, setCategories] = useState<any[]>([]);
    const [items, setItems] = useState<any[]>([]);

    // Categorías tab state
    const [categoryModal, setCategoryModal] = useState<{ open: boolean; editing: any | null }>({ open: false, editing: null });
    const [catNameEn, setCatNameEn] = useState('');
    const [catNameEs, setCatNameEs] = useState('');
    const [catSubtitleEn, setCatSubtitleEn] = useState('');
    const [catSubtitleEs, setCatSubtitleEs] = useState('');
    const [catError, setCatError] = useState<string | null>(null);

    // Platos tab state
    const [categoryFilter, setCategoryFilter] = useState<string>('all');
    const [itemModal, setItemModal] = useState<{ open: boolean; editing: any | null }>({ open: false, editing: null });
    const [itemError, setItemError] = useState<string | null>(null);

    // Clover sync state
    const [syncing, setSyncing] = useState(false);
    const [syncResult, setSyncResult] = useState<any>(null);
    const [showSkipped, setShowSkipped] = useState(false);

    // "Actualizar iPads ahora" (forceToken rotation) state
    const [publishing, setPublishing] = useState(false);
    const [publishResult, setPublishResult] = useState<{ ok: boolean; text: string } | null>(null);

    const loadAll = async () => {
        const [cats, its] = await Promise.all([getMenuCategoriesAdmin(), getMenuItemsAdmin()]);
        setCategories(cats);
        setItems(its);
    };

    useEffect(() => { loadAll(); }, []);

    if (!isAdmin) return null; // restrictedRoutes in AdminContext already redirects non-admins

    // ============ CATEGORÍAS handlers ============

    const openCategoryModal = (cat: any | null) => {
        setCatNameEn(cat?.nameEn || '');
        setCatNameEs(cat?.nameEs || '');
        setCatSubtitleEn(cat?.subtitleEn || '');
        setCatSubtitleEs(cat?.subtitleEs || '');
        setCatError(null);
        setCategoryModal({ open: true, editing: cat });
    };

    const handleSaveCategory = async (e: React.FormEvent) => {
        e.preventDefault();
        setCatError(null);
        const payload = { nameEn: catNameEn, nameEs: catNameEs, subtitleEn: catSubtitleEn, subtitleEs: catSubtitleEs };
        const result = categoryModal.editing
            ? await updateMenuCategory(categoryModal.editing.id, payload)
            : await createMenuCategory(payload);
        if (result.success) {
            setCategoryModal({ open: false, editing: null });
            loadAll();
        } else {
            setCatError(result.error || 'Error al guardar.');
        }
    };

    const handleToggleCategoryActive = async (cat: any) => {
        setCategories(prev => prev.map(c => c.id === cat.id ? { ...c, isActive: !c.isActive } : c));
        const result = await updateMenuCategory(cat.id, { isActive: !cat.isActive });
        if (!result.success) loadAll();
    };

    const handleMoveCategory = async (index: number, direction: -1 | 1) => {
        const target = index + direction;
        if (target < 0 || target >= categories.length) return;
        const reordered = [...categories];
        [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
        setCategories(reordered);
        await reorderMenuCategories(reordered.map(c => c.id));
    };

    const handleDeleteCategory = async (cat: any) => {
        if (!confirm(`¿Eliminar la categoría "${cat.nameEs}"?`)) return;
        const result = await deleteMenuCategory(cat.id);
        if (!result.success) alert(result.error);
        loadAll();
    };

    // ============ PLATOS handlers ============

    const filteredItems = items.filter(item => {
        if (categoryFilter === 'all') return true;
        if (categoryFilter === UNCATEGORIZED) return !item.menuCategoryId;
        return item.menuCategoryId === categoryFilter;
    });

    const handleQuickToggle = async (item: any, field: 'isAvailable' | 'isFeatured') => {
        const newValue = !item[field];
        setItems(prev => prev.map(i => i.id === item.id ? { ...i, [field]: newValue } : i));
        const result = await updateMenuItem(item.id, { [field]: newValue } as any);
        if (!result.success) {
            setItemError(result.error || 'Error al guardar.');
            loadAll();
        }
    };

    // The Eye button writes hiddenInApp, NOT isAvailable: isAvailable mirrors
    // Clover's own flag and the next sync would undo anything set here.
    const handleToggleHidden = async (item: any) => {
        const newValue = !item.hiddenInApp;
        setItems(prev => prev.map(i => i.id === item.id ? { ...i, hiddenInApp: newValue } : i));
        const result = await updateMenuItem(item.id, { hiddenInApp: newValue } as any);
        if (!result.success) {
            setItemError(result.error || 'Error al guardar.');
            loadAll();
        }
    };

    // "Agotado hoy" writes soldOutAt (app-owned; syncMenuFromClover never
    // touches it). Optimistic like the Eye button: flip locally, then rollback
    // by reloading if the action fails. Clearing writes null; otherwise the
    // mark simply stops counting at the next business-day cutover.
    const handleToggleSoldOut = async (item: any) => {
        const soldOut = !isSoldOutToday(item.soldOutAt);
        setItems(prev => prev.map(i => i.id === item.id ? { ...i, soldOutAt: soldOut ? new Date().toISOString() : null } : i));
        const result = await setMenuItemSoldOut(item.id, soldOut);
        if (!result.success) {
            setItemError(result.error || 'Error al guardar.');
            loadAll();
        }
    };

    const handlePublish = async () => {
        if (!confirm(PUBLISH_CONFIRM)) return;
        setPublishing(true);
        setPublishResult(null);
        try {
            const result = await forceMenuRepublish();
            setPublishResult(result.success
                ? { ok: true, text: 'Listo. Cada iPad descargará el menú completo en su próxima comprobación (unos 2 minutos). Los que estén sin conexión lo harán al reconectarse.' }
                : { ok: false, text: result.error || 'No se pudo actualizar los iPads.' });
        } catch (e) {
            setPublishResult({ ok: false, text: e instanceof Error ? e.message : String(e) });
        } finally {
            setPublishing(false);
        }
    };

    const handleSyncClover = async () => {
        setSyncing(true);
        setSyncResult(null);
        setShowSkipped(false);
        try {
            const result = await syncMenuFromClover();
            setSyncResult(result);
            await loadAll();
        } catch (e) {
            setSyncResult({ error: e instanceof Error ? e.message : String(e) });
        } finally {
            setSyncing(false);
        }
    };

    const handleMoveItem = async (index: number, direction: -1 | 1) => {
        // Reorder is only offered when a single real category is selected.
        const target = index + direction;
        if (target < 0 || target >= filteredItems.length) return;
        const reordered = [...filteredItems];
        [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
        const orderedIds = reordered.map(i => i.id);
        setItems(prev => {
            const rest = prev.filter(i => i.menuCategoryId !== categoryFilter);
            return [...rest, ...reordered.map((i, idx) => ({ ...i, sortOrder: idx }))];
        });
        await reorderMenuItems(categoryFilter, orderedIds);
        loadAll();
    };

    const handleDeleteItem = async (item: any) => {
        if (!confirm(`¿Eliminar el plato "${item.name}"?`)) return;
        const result = await deleteMenuItem(item.id);
        if (!result.success) {
            alert(result.error);
        }
        loadAll();
    };

    const canReorderItems = categoryFilter !== 'all' && categoryFilter !== UNCATEGORIZED;

    const tabStyle = (tab: TabId): React.CSSProperties => ({
        padding: '0.75rem 1.5rem',
        borderRadius: '8px 8px 0 0',
        border: 'none',
        borderBottom: activeTab === tab ? '2px solid var(--accent-primary)' : '2px solid transparent',
        background: 'transparent',
        color: activeTab === tab ? 'var(--text-primary)' : 'var(--text-secondary)',
        fontWeight: activeTab === tab ? 600 : 400,
        fontSize: '1rem',
        cursor: 'pointer',
        minHeight: '44px'
    });

    const iconBtnStyle: React.CSSProperties = {
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: '40px', height: '40px', borderRadius: '8px',
        border: '1px solid var(--border)', background: 'transparent',
        color: 'var(--text-secondary)', cursor: 'pointer'
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <style>{'@keyframes mp-spin { to { transform: rotate(360deg); } }'}</style>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                    <h1 style={{ fontSize: '2.5rem', marginBottom: '0.25rem' }}>Menú Digital</h1>
                    <a
                        href="/menu"
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', color: 'var(--accent-primary)', fontSize: '0.95rem', textDecoration: 'none' }}
                    >
                        Ver menú público <ExternalLink size={14} />
                    </a>
                </div>
            </div>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border)' }}>
                <button onClick={() => setActiveTab('platos')} style={tabStyle('platos')}>Platos</button>
                <button onClick={() => setActiveTab('categorias')} style={tabStyle('categorias')}>Categorías</button>
                <button onClick={() => setActiveTab('costos')} style={tabStyle('costos')}>Costos y Recetas</button>
            </div>

            {/* ============ CATEGORÍAS TAB ============ */}
            {activeTab === 'categorias' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <button onClick={() => openCategoryModal(null)} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderRadius: '8px', minHeight: '44px' }}>
                            <Plus size={18} /> Nueva Categoría
                        </button>
                    </div>

                    {categories.length === 0 && (
                        <p style={{ color: 'var(--text-secondary)', padding: '2rem', textAlign: 'center' }}>
                            No hay categorías todavía. Crea la primera para organizar el menú digital.
                        </p>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {categories.map((cat, index) => (
                            <div key={cat.id} className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.75rem 1rem', opacity: cat.isActive ? 1 : 0.55 }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                                    <button onClick={() => handleMoveCategory(index, -1)} disabled={index === 0} style={{ ...iconBtnStyle, width: '32px', height: '22px', opacity: index === 0 ? 0.3 : 1 }} title="Subir"><ChevronUp size={16} /></button>
                                    <button onClick={() => handleMoveCategory(index, 1)} disabled={index === categories.length - 1} style={{ ...iconBtnStyle, width: '32px', height: '22px', opacity: index === categories.length - 1 ? 0.3 : 1 }} title="Bajar"><ChevronDown size={16} /></button>
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 600 }}>{cat.nameEs}</div>
                                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{cat.nameEn}</div>
                                </div>
                                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                                    {cat._count?.menuItems ?? 0} plato(s)
                                </span>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', minHeight: '44px' }} title={cat.isActive ? 'Categoría visible en el menú público' : 'Categoría oculta'}>
                                    <input type="checkbox" checked={cat.isActive} onChange={() => handleToggleCategoryActive(cat)} style={{ width: '20px', height: '20px' }} />
                                    <span style={{ fontSize: '0.85rem' }}>Activa</span>
                                </label>
                                <button onClick={() => openCategoryModal(cat)} style={iconBtnStyle} title="Editar"><Pencil size={18} /></button>
                                <button
                                    onClick={() => handleDeleteCategory(cat)}
                                    disabled={(cat._count?.menuItems ?? 0) > 0}
                                    style={{ ...iconBtnStyle, color: 'var(--danger)', opacity: (cat._count?.menuItems ?? 0) > 0 ? 0.3 : 1, cursor: (cat._count?.menuItems ?? 0) > 0 ? 'not-allowed' : 'pointer' }}
                                    title={(cat._count?.menuItems ?? 0) > 0 ? 'No se puede eliminar: tiene platos asignados' : 'Eliminar categoría'}
                                >
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ============ PLATOS TAB ============ */}
            {activeTab === 'platos' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {itemError && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#ef4444', fontSize: '0.9rem', padding: '0.75rem', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                            <span>{itemError}</span>
                            <button onClick={() => setItemError(null)} style={{ color: 'inherit', padding: '0.25rem' }}><X size={16} /></button>
                        </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                            <select
                                value={categoryFilter}
                                onChange={e => setCategoryFilter(e.target.value)}
                                className="input-field"
                                style={{ maxWidth: '320px', minHeight: '44px' }}
                            >
                                <option value="all">Todas las categorías</option>
                                {categories.map((cat: any) => (
                                    <option key={cat.id} value={cat.id}>{cat.nameEs} / {cat.nameEn}</option>
                                ))}
                                <option value={UNCATEGORIZED}>Sin categoría</option>
                            </select>
                            <button
                                onClick={handleSyncClover}
                                disabled={syncing}
                                className="btn-secondary"
                                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderRadius: '8px', minHeight: '44px', padding: '0 1rem', opacity: syncing ? 0.6 : 1, cursor: syncing ? 'wait' : 'pointer' }}
                                title="Traer platos, precios y categorías desde Clover"
                            >
                                <RefreshCw size={16} style={syncing ? { animation: 'mp-spin 1s linear infinite' } : undefined} />
                                {syncing ? 'Sincronizando…' : 'Sincronizar con Clover'}
                            </button>
                            <button
                                onClick={handlePublish}
                                disabled={publishing}
                                className="btn-secondary"
                                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderRadius: '8px', minHeight: '44px', padding: '0 1rem', opacity: publishing ? 0.6 : 1, cursor: publishing ? 'wait' : 'pointer' }}
                                title="Obliga a todos los iPads del salón a descargar el menú completo en su próxima comprobación (~2 min), sin esperar a las 9:00 AM"
                            >
                                <Tablet size={16} />
                                {publishing ? 'Avisando a los iPads…' : 'Actualizar iPads ahora'}
                            </button>
                        </div>
                        <button onClick={() => setItemModal({ open: true, editing: null })} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderRadius: '8px', minHeight: '44px' }}>
                            <Plus size={18} /> Nuevo Plato
                        </button>
                    </div>

                    {publishResult && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', padding: '0.85rem 1rem', borderRadius: '8px', fontSize: '0.9rem', background: publishResult.ok ? 'rgba(34, 197, 94, 0.08)' : 'rgba(239, 68, 68, 0.1)', border: publishResult.ok ? '1px solid rgba(34, 197, 94, 0.25)' : '1px solid rgba(239, 68, 68, 0.25)', color: publishResult.ok ? 'inherit' : '#ef4444' }}>
                            <span>{publishResult.text}</span>
                            <button onClick={() => setPublishResult(null)} style={{ color: 'inherit', padding: '0.25rem' }} title="Cerrar"><X size={16} /></button>
                        </div>
                    )}

                    {syncResult && (
                        <div style={{ padding: '0.85rem 1rem', borderRadius: '8px', fontSize: '0.9rem', background: syncResult.error ? 'rgba(239, 68, 68, 0.1)' : 'rgba(34, 197, 94, 0.08)', border: syncResult.error ? '1px solid rgba(239, 68, 68, 0.25)' : '1px solid rgba(34, 197, 94, 0.25)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
                                <div>
                                    {syncResult.error ? (
                                        <span style={{ color: '#ef4444' }}>{syncResult.error}</span>
                                    ) : (
                                        <>
                                            <div style={{ fontWeight: 600 }}>
                                                {[
                                                    syncResult.created + ' creados',
                                                    syncResult.adopted ? syncResult.adopted + ' vinculados' : null,
                                                    syncResult.updated + ' actualizados',
                                                    syncResult.unchanged + ' sin cambios en Clover',
                                                    syncResult.orphaned ? syncResult.orphaned + ' ya no están en Clover' : null,
                                                    (syncResult.skipped || []).length + ' omitidos',
                                                ].filter(Boolean).join(' · ')}
                                            </div>
                                            {(syncResult.categoriesCreated > 0 || syncResult.categoriesLinked > 0) && (
                                                <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '0.2rem' }}>
                                                    Categorías: {syncResult.categoriesCreated} creadas · {syncResult.categoriesLinked} vinculadas
                                                </div>
                                            )}
                                        </>
                                    )}
                                </div>
                                <button onClick={() => setSyncResult(null)} style={{ color: 'inherit', padding: '0.25rem' }} title="Cerrar"><X size={16} /></button>
                            </div>

                            {!syncResult.error && (syncResult.skipped || []).length > 0 && (
                                <div style={{ marginTop: '0.6rem' }}>
                                    <button
                                        onClick={() => setShowSkipped(v => !v)}
                                        style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--text-secondary)', fontSize: '0.85rem', padding: '0.25rem 0' }}
                                    >
                                        {showSkipped ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                        {showSkipped ? 'Ocultar' : 'Ver'} los {syncResult.skipped.length} omitidos
                                    </button>
                                    {showSkipped && (
                                        <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.1rem', color: 'var(--text-secondary)', fontSize: '0.85rem', maxHeight: '220px', overflowY: 'auto' }}>
                                            {syncResult.skipped.map((sk: any, i: number) => (
                                                <li key={i} style={{ marginBottom: '0.15rem' }}>
                                                    <strong style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{sk.name}</strong> {'—'} {sk.reason}
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {filteredItems.length === 0 && (
                        <p style={{ color: 'var(--text-secondary)', padding: '2rem', textAlign: 'center' }}>
                            No hay platos en esta vista.
                        </p>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {filteredItems.map((item, index) => (
                            <div key={item.id} className="glass-panel" style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.75rem 1rem', opacity: (item.isAvailable && !item.hiddenInApp) ? 1 : 0.55 }}>
                                {canReorderItems && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                                        <button onClick={() => handleMoveItem(index, -1)} disabled={index === 0} style={{ ...iconBtnStyle, width: '32px', height: '22px', opacity: index === 0 ? 0.3 : 1 }} title="Subir"><ChevronUp size={16} /></button>
                                        <button onClick={() => handleMoveItem(index, 1)} disabled={index === filteredItems.length - 1} style={{ ...iconBtnStyle, width: '32px', height: '22px', opacity: index === filteredItems.length - 1 ? 0.3 : 1 }} title="Bajar"><ChevronDown size={16} /></button>
                                    </div>
                                )}

                                {/* Thumbnail */}
                                {item.photoUrl ? (
                                    <img src={item.photoUrl} alt={item.name} style={{ width: '52px', height: '52px', objectFit: 'cover', borderRadius: '8px', border: '1px solid var(--border)', flexShrink: 0 }} />
                                ) : (
                                    <div style={{ width: '52px', height: '52px', borderRadius: '8px', border: '1px dashed var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)', flexShrink: 0, background: 'var(--bg-secondary)' }}>
                                        <ImageIcon size={20} />
                                    </div>
                                )}

                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {item.name}
                                        {item.nameEs && <span style={{ fontWeight: 400, color: 'var(--text-secondary)' }}> · {item.nameEs}</span>}
                                    </div>
                                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                        {item.menuCategory ? `${item.menuCategory.nameEs}` : 'Sin categoría'}
                                        {item.cloverId && <span title="Vinculado a Clover POS"> · Clover</span>}
                                    </div>
                                    {(isSoldOutToday(item.soldOutAt) || item.cloverMissingAt || (item.cloverId && (item._count?.recipeIngredients ?? 0) === 0)) && (
                                        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', marginTop: '0.25rem' }}>
                                            {isSoldOutToday(item.soldOutAt) && (
                                                <span style={chipStyle('#ef4444')} title="Marcado como agotado hoy. Se quita solo al cambiar el día de negocio (5:00 AM).">Agotado hoy</span>
                                            )}
                                            {item.cloverId && (item._count?.recipeIngredients ?? 0) === 0 && (
                                                <span style={chipStyle('#f59e0b')} title="Vinculado a Clover pero sin receta: no aporta al costeo">Sin receta</span>
                                            )}
                                            {item.cloverMissingAt && (
                                                <span style={chipStyle('#ef4444')} title="Clover ya no devuelve este artículo. La fila se conserva por la receta y el costeo.">No está en Clover</span>
                                            )}
                                        </div>
                                    )}
                                </div>

                                <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>${(item.salePrice ?? 0).toFixed(2)}</span>

                                <button
                                    onClick={() => handleToggleHidden(item)}
                                    style={{ ...iconBtnStyle, color: item.hiddenInApp ? 'var(--text-secondary)' : 'var(--success)' }}
                                    title={
                                        item.hiddenInApp
                                            ? 'Oculto por el equipo — clic para mostrar'
                                            : (item.isAvailable
                                                ? 'Visible en el menú — clic para ocultar'
                                                : 'No disponible en Clover — clic para ocultarlo también aquí')
                                    }
                                >
                                    {item.hiddenInApp ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                                <button
                                    onClick={() => handleToggleSoldOut(item)}
                                    style={{ ...iconBtnStyle, color: isSoldOutToday(item.soldOutAt) ? '#ef4444' : 'var(--text-secondary)', borderColor: isSoldOutToday(item.soldOutAt) ? '#ef444455' : 'var(--border)' }}
                                    title={
                                        isSoldOutToday(item.soldOutAt)
                                            ? 'Agotado hoy — clic para volver a ofrecerlo'
                                            : 'Marcar como agotado hoy (los iPads lo muestran en unos 2 minutos; se quita solo mañana)'
                                    }
                                >
                                    <Ban size={18} />
                                </button>
                                <button
                                    onClick={() => handleQuickToggle(item, 'isFeatured')}
                                    style={{ ...iconBtnStyle, color: item.isFeatured ? '#f59e0b' : 'var(--text-secondary)' }}
                                    title={item.isFeatured ? 'Destacado — clic para quitar' : 'Marcar como destacado'}
                                >
                                    <Star size={18} fill={item.isFeatured ? '#f59e0b' : 'none'} />
                                </button>
                                <button onClick={() => setItemModal({ open: true, editing: item })} style={iconBtnStyle} title="Editar"><Pencil size={18} /></button>
                                <button onClick={() => handleDeleteItem(item)} style={{ ...iconBtnStyle, color: 'var(--danger)' }} title="Eliminar"><Trash2 size={18} /></button>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ============ COSTOS TAB (legacy Menu Items & Recipes view) ============ */}
            {activeTab === 'costos' && <CostosTab />}

            {/* Category create/edit modal */}
            {categoryModal.open && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.6)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '1rem'
                }}>
                    <div className="glass-panel" style={{ width: '100%', maxWidth: '440px', padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.25rem', background: 'var(--bg-primary)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '1rem' }}>
                            <h2 style={{ fontSize: '1.3rem', margin: 0 }}>{categoryModal.editing ? 'Editar Categoría' : 'Nueva Categoría'}</h2>
                            <button onClick={() => setCategoryModal({ open: false, editing: null })} style={{ color: 'var(--text-secondary)', padding: '0.5rem' }}><X size={20} /></button>
                        </div>
                        {catError && (
                            <div style={{ color: '#ef4444', fontSize: '0.9rem', padding: '0.75rem', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                                {catError}
                            </div>
                        )}
                        <form onSubmit={handleSaveCategory} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Nombre (EN) *</label>
                                <input value={catNameEn} onChange={e => setCatNameEn(e.target.value)} type="text" className="input-field" placeholder="p.ej. Ceviches" required />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Nombre (ES) *</label>
                                <input value={catNameEs} onChange={e => setCatNameEs(e.target.value)} type="text" className="input-field" placeholder="p.ej. Ceviches" required />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Subtítulo (ES)</label>
                                <input value={catSubtitleEs} onChange={e => setCatSubtitleEs(e.target.value)} type="text" className="input-field" placeholder="Texto corto que ayuda al cliente a elegir." />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Subtítulo (EN)</label>
                                <input value={catSubtitleEn} onChange={e => setCatSubtitleEn(e.target.value)} type="text" className="input-field" placeholder="Short line that helps guests choose." />
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', paddingTop: '0.5rem' }}>
                                <button type="button" onClick={() => setCategoryModal({ open: false, editing: null })} style={{ padding: '0.65rem 1.25rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer', minHeight: '44px' }}>
                                    Cancelar
                                </button>
                                <button type="submit" className="btn-primary" style={{ borderRadius: '8px', minHeight: '44px' }}>Guardar</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Item create/edit modal */}
            <ItemEditorModal
                isOpen={itemModal.open}
                onClose={() => setItemModal({ open: false, editing: null })}
                onSaved={loadAll}
                categories={categories.filter((c: any) => c.isActive)}
                initialData={itemModal.editing}
                defaultCategoryId={canReorderItems ? categoryFilter : null}
            />
        </div>
    );
}
