'use client';

import { Search, Plus, Filter, Calendar, Settings, Pencil, Trash2, Upload, Minus, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import Papa from 'papaparse';
import AddIngredientModal from '@/components/modals/AddIngredientModal';
import ManageOptionsModal from '@/components/modals/ManageOptionsModal';
import RecipeBuilderModal from '@/components/modals/RecipeBuilderModal';
import { getCategories, getInventory, addCategory, editCategory, deleteCategory, addIngredient, editIngredient, deleteIngredient, bulkAddIngredients, logWaste, logInventoryAdjustment, setUnfrozenQuantityAction, getProviders, addProvider, editProvider, deleteProvider } from '@/app/actions/inventory';
import { getPrepUsers } from '@/app/actions/users';
import { syncCloverSales, getLastSyncTime } from '@/app/actions/clover';
import { getDropdownOptions } from '@/app/actions/dropdownOptions';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { getConversionFactor } from '@/lib/conversion';

interface Ingredient {
    id: string;
    name: string;
    parentId?: string | null;
    provider?: any;
    providerName?: string;
    initialQty?: number;
    portionWeightG?: number;
    rawName?: string;
    nameEs?: string | null;
    autoTranslate?: boolean;
    category: string;
    rawCategory?: string;
    categoryNameEs?: string | null;
    type: 'RAW' | 'PROCESSED' | 'PREP_RECIPE';
    total: number;
    metric: string;
    yieldPercent: number;
    status: 'GOOD' | 'LOW' | 'OUT';
    currentPrice: number;
    parent?: any;
    calculatedCost?: number;
    cloverId?: string | null;
    cloverSoldToday?: number;
    unfrozenQuantity?: number;
    trackFreezerStatus?: boolean;
}

const MOCK_INVENTORY: Ingredient[] = [
    { id: '1', name: 'Raw Shrimp', category: 'Seafood', type: 'RAW', total: 12, metric: 'kg', yieldPercent: 80, status: 'GOOD', currentPrice: 15.0 },
    { id: '2', name: 'Octopus (Pulpo)', category: 'Seafood', type: 'RAW', total: 2.5, metric: 'kg', yieldPercent: 85, status: 'LOW', currentPrice: 20.0 },
    { id: '3', name: 'Purple Corn', category: 'Dry Goods', type: 'RAW', total: 0.5, metric: 'kg', yieldPercent: 95, status: 'OUT', currentPrice: 2.5 },
    { id: '4', name: 'Chicha Base', category: 'Prep', type: 'PROCESSED', total: 15, metric: 'L', yieldPercent: 100, status: 'GOOD', currentPrice: 0 },
    { id: '5', name: 'Ceviche Marinade', category: 'Prep', type: 'PROCESSED', total: 1.2, metric: 'L', yieldPercent: 98, status: 'LOW', currentPrice: 0 },
];

interface ProductionSchedule {
    id: string;
    name: string;
    targetAmount: number;
    metric: string;
    nextProductionDate: string;
}

const MOCK_PRODUCTION: ProductionSchedule[] = [
    { id: '1', name: 'Chicha Base', targetAmount: 20, metric: 'L', nextProductionDate: '2026-02-21' },
    { id: '2', name: 'Ceviche Marinade', targetAmount: 8, metric: 'L', nextProductionDate: '2026-02-20' },
    { id: '3', name: 'Octopus (Pulpo) Thawing', targetAmount: 3, metric: 'kg', nextProductionDate: '2026-02-20' },
];

export default function InventoryPage() {
    const [activeTab, setActiveTab] = useState<'ALL' | 'ALL_INGREDIENTS' | 'CATEGORIES' | 'PRODUCTION' | 'PREP_RECIPES'>('ALL');
    const [categoryTab, setCategoryTab] = useState<'CATEGORIES' | 'PROVEEDORES'>('CATEGORIES');
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

    const toggleCategoryExpand = (id: string) => {
        setExpandedCategories(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };
    const [overviewTab, setOverviewTab] = useState<'RAW' | 'FREEZER' | 'PROCESSED' | 'RELATIONSHIPS'>('FREEZER');
    const [rawCategoryFilter, setRawCategoryFilter] = useState('');
    const [rawIngredientFilter, setRawIngredientFilter] = useState('');
    const [processedCategoryFilter, setProcessedCategoryFilter] = useState('');
    const [processedIngredientFilter, setProcessedIngredientFilter] = useState('');
    const [allIngredientsCategoryFilter, setAllIngredientsCategoryFilter] = useState('');
    const [allIngredientsNameFilter, setAllIngredientsNameFilter] = useState('');
    const [allIngredientsTypeFilter, setAllIngredientsTypeFilter] = useState<'ALL' | 'PARENT' | 'CHILD'>('ALL');

    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isRecipeModalOpen, setIsRecipeModalOpen] = useState(false);
    const [editingIngredient, setEditingIngredient] = useState<any>(null);
    const [isManageOptionsOpen, setIsManageOptionsOpen] = useState(false);
    const t = useTranslations('Inventory');
    const tOptions = useTranslations('Options');
    const locale = useLocale();
    const router = useRouter();
    const [schedules, setSchedules] = useState<ProductionSchedule[]>(MOCK_PRODUCTION);

    const [dbIngredients, setDbIngredients] = useState<any[]>([]);
    const [dbCategories, setDbCategories] = useState<any[]>([]);
    const [dbProviders, setDbProviders] = useState<any[]>([]);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
    const [wastes, setWastes] = useState<Record<string, string>>({});

    // Inventory adjustments state
    const [prepUsers, setPrepUsers] = useState<any[]>([]);
    const [adjustments, setAdjustments] = useState<Record<string, number>>({});
    const [confirmingAdjust, setConfirmingAdjust] = useState<string | null>(null);
    const [adjustCook, setAdjustCook] = useState<string>('');
    const [draftUnfrozen, setDraftUnfrozen] = useState<Record<string, number>>({});

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        const [invRes, catRes, provRes, syncRes, usersRes] = await Promise.all([getInventory(), getCategories('INGREDIENT'), getProviders(), getLastSyncTime(), getPrepUsers()]);
        setDbIngredients(invRes);
        setDbCategories(catRes);
        setDbProviders(provRes);
        setLastSyncTime(syncRes);
        setPrepUsers(usersRes);
    };

    const handleSyncClover = async () => {
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

    const handleWasteSubmit = async (id: string) => {
        const qty = parseFloat(wastes[id]);
        if (!qty || qty <= 0) return;

        const res = await logWaste(id, Math.abs(qty));
        if (res.success) {
            setWastes(prev => ({ ...prev, [id]: '' }));
            loadData();
        } else {
            alert('Failed to log waste');
        }
    };

    const handleAdjustChange = (item: Ingredient, delta: number) => {
        setAdjustments(prev => {
            const current = prev[item.id] || 0;
            return { ...prev, [item.id]: current + delta };
        });
    };

    const handleConfirmAdjustSubmit = async (item: Ingredient) => {
        if (!adjustCook) {
            alert('Please select a cook before submitting.');
            return;
        }
        const delta = adjustments[item.id] || 0;
        if (delta === 0) {
            setConfirmingAdjust(null);
            return;
        }

        const res = await logInventoryAdjustment(item.id, delta, adjustCook);
        if (res.success) {
            setAdjustments(prev => ({ ...prev, [item.id]: 0 }));
            setConfirmingAdjust(null);
            setAdjustCook('');
            loadData();
        } else {
            alert(res.error || 'Failed to adjust inventory');
        }
    };

    const handleConfirmUnfrozen = async (item: Ingredient) => {
        const draftValue = draftUnfrozen[item.id];
        if (draftValue === undefined) return;

        const res = await setUnfrozenQuantityAction(item.id, draftValue);
        if (res.success) {
            setDraftUnfrozen(prev => {
                const next = { ...prev };
                delete next[item.id];
                return next;
            });
            await loadData();
            router.refresh();
        } else {
            alert(res.error || 'Failed to update Unfrozen stat.');
        }
    };

    const handleSaveIngredient = async (data: any) => {
        setIsAddModalOpen(false);
        let res;
        if (editingIngredient) {
            res = await editIngredient(editingIngredient.id, data);
            setEditingIngredient(null);
        } else {
            res = await addIngredient(data);
        }

        if (res.success) {
            loadData();
        } else {
            alert(res.error || 'Failed to save ingredient');
        }
    };

    const handleDeleteIngredient = async (id: string) => {
        if (!confirm('Are you sure you want to delete this ingredient?')) return;
        const res = await deleteIngredient(id);
        if (res.success) {
            loadData();
        } else {
            alert(res.error || 'Failed to delete ingredient');
        }
    };

    const handleDeleteCategory = async (id: string) => {
        if (!confirm('Are you sure you want to delete this category?')) return;
        const res = await deleteCategory(id);
        if (res.success) {
            loadData();
        } else {
            alert(res.error || 'Failed to delete category');
        }
    };

    const handleAddProvider = async () => {
        const name = prompt('Nombre del Proveedor (Supplier Name):');
        if (!name) return;
        await addProvider(name);
        loadData();
    };

    const handleEditProvider = async (id: string, oldName: string) => {
        const name = prompt('Nuevo Nombre (New Name):', oldName);
        if (!name || name === oldName) return;
        await editProvider(id, name);
        loadData();
    };

    const handleDeleteProvider = async (id: string) => {
        if (!confirm('Eliminar Proveedor (Delete Supplier)?')) return;
        await deleteProvider(id);
        loadData();
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsUploading(true);
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: async (results) => {
                const data = results.data as any[];
                const formattedData = data.map(item => {
                    let rawType = (item.type || item.Type || 'RAW').toString().toUpperCase();
                    let finalType = 'RAW';
                    if (rawType.includes('PROCESS') || rawType === 'PROCESSED') finalType = 'PROCESSED';
                    else if (rawType === 'RAW') finalType = 'RAW';
                    else finalType = rawType; // fallback if they defined custom types

                    return {
                        name: item.name || item.Name,
                        categoryName: item.categoryName || item.Category || 'Uncategorized',
                        providerName: item.providerName || item.Provider || '',
                        type: finalType,
                        metric: item.metric || item.Metric || 'units',
                        initialQty: parseFloat(item.initialQty || item.Qty || item.Quantity || 0),
                        yieldPercent: parseFloat(item.yieldPercent || item.Yield || 100),
                    };
                }).filter(item => item.name); // basic validation

                if (formattedData.length > 0) {
                    const res = await bulkAddIngredients(formattedData);
                    if (res?.success) {
                        alert(`Successfully imported ${res.count} ingredients!`);
                        loadData();
                    } else {
                        alert('Error importing ingredients');
                    }
                } else {
                    alert('No valid ingredients found in CSV - check headers (Name, Category, Provider, Type, Metric, Qty, Yield)');
                }
                setIsUploading(false);
                if (fileInputRef.current) fileInputRef.current.value = '';
            },
            error: (error: any) => {
                console.error(error);
                alert('Failed to parse CSV');
                setIsUploading(false);
                if (fileInputRef.current) fileInputRef.current.value = '';
            }
        });
    };

    const resolveCost = (item: any, visited = new Set<string>()): number => {
        if (!item) return 0;
        if (visited.has(item.id)) return 0;
        const newVisited = new Set(visited);
        newVisited.add(item.id);

        if (item.type === 'RAW') {
            return item.currentPrice || 0;
        }
        if (item.type === 'PROCESSED') {
            if (item.metric?.toLowerCase() === 'units') return item.currentPrice || 0;
            const parent = dbIngredients?.find(dbI => dbI?.id === item.parent?.id) || item.parent;
            const parentCost = parent ? resolveCost(parent, newVisited) : (item.currentPrice || 0);
            return parentCost / Math.max(0.01, ((item.yieldPercent || 100) / 100));
        }
        if (item.type === 'PREP_RECIPE') {
            return (item.currentPrice || 0) / Math.max(0.01, ((item.yieldPercent || 100) / 100));
        }
        return item.currentPrice || 0;
    };

    const mappedInventory: Ingredient[] = dbIngredients.map(item => ({
        id: item.id,
        name: locale === 'es' && item.nameEs ? item.nameEs : item.name,
        rawName: item.name,
        nameEs: item.nameEs,
        autoTranslate: item.autoTranslate,
        category: locale === 'es' && item.category?.nameEs ? item.category.nameEs : (item.category?.name || 'Uncategorized'),
        rawCategory: item.category?.name || 'Uncategorized',
        categoryNameEs: item.category?.nameEs,
        type: item.type as any,
        total: item.inventory?.frozenQty || 0,
        metric: item.metric || 'units',
        yieldPercent: item.yieldPercent,
        status: (item.inventory?.frozenQty || 0) > 5 ? 'GOOD' : ((item.inventory?.frozenQty || 0) > 0 ? 'LOW' : 'OUT'),
        currentPrice: item.currentPrice || 0,
        parent: item.parent,
        parentId: item.parentId,
        provider: item.provider,
        providerName: item.provider?.name,
        initialQty: item.inventory?.frozenQty || 0,
        portionWeightG: item.portionWeightG,
        cloverId: item.cloverId,
        cloverSoldToday: item.transactions?.reduce((sum: number, tx: any) => sum + tx.qty, 0) || 0,
        unfrozenQuantity: item.unfrozenQuantity || 0,
        trackFreezerStatus: item.trackFreezerStatus || false,
        composedOf: item.composedOf || [],
        calculatedCost: resolveCost(item)
    }));

    const filteredInventory = mappedInventory.filter(item => true /* all */);

    const groupedInventory = filteredInventory.reduce((acc, item) => {
        if (!acc[item.category]) acc[item.category] = [];
        acc[item.category].push(item);
        return acc;
    }, {} as Record<string, Ingredient[]>);

    const getStatusColor = (status: string) => {
        if (status === 'GOOD') return 'var(--success)';
        if (status === 'LOW') return 'var(--warning)';
        return 'var(--danger)';
    };

    const getOptName = (name: string) => {
        if (!name) return name;
        try {
            const translated = tOptions(name as any);
            if (translated && translated.includes('Options.')) return name;
            return translated || name;
        } catch { return name; }
    };

    const renderIngredientBox = (item: Ingredient) => {
        const adj = adjustments[item.id] || 0;
        const totalWithAdj = item.total + adj;

        return (
            <div key={item.id} className="glass-panel" style={{ flex: '1 1 300px', minWidth: '280px', padding: '1.25rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <h3 style={{ fontSize: '1.2rem', fontWeight: 600, margin: 0 }}>{item.name}</h3>
                    {item.type === 'PROCESSED' && item.parent && (
                        <span style={{ fontSize: '0.85rem', color: 'var(--accent-primary)', marginTop: '0.2rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                            ↳ Formed from: <strong>{item.parent.name}</strong>
                        </span>
                    )}
                    {(item as any).provider?.name && (
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>{(item as any).provider.name}</span>
                    )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {/* Add Adjustment UI for RAW ingredients */}
                    {item.type === 'RAW' && (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <button onClick={() => handleAdjustChange(item, -1)} style={{ width: '30px', height: '30px', borderRadius: '50%', border: 'none', background: 'var(--accent-primary)', color: 'white', display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer', transition: 'opacity 0.2s', opacity: 0.85 }} onMouseOver={(e) => e.currentTarget.style.opacity = '1'} onMouseOut={(e) => e.currentTarget.style.opacity = '0.85'}>
                                    <Minus size={16} />
                                </button>
                                <div style={{ width: '40px', textAlign: 'center', fontWeight: 'bold' }}>{adj > 0 ? `+${adj}` : adj}</div>
                                <button onClick={() => handleAdjustChange(item, 1)} style={{ width: '30px', height: '30px', borderRadius: '50%', border: 'none', background: 'var(--accent-primary)', color: 'white', display: 'flex', justifyContent: 'center', alignItems: 'center', cursor: 'pointer', transition: 'opacity 0.2s', opacity: 0.85 }} onMouseOver={(e) => e.currentTarget.style.opacity = '1'} onMouseOut={(e) => e.currentTarget.style.opacity = '0.85'}>
                                    <Plus size={16} />
                                </button>
                            </div>

                            {adj !== 0 && confirmingAdjust !== item.id && (
                                <button onClick={() => setConfirmingAdjust(item.id)} className="btn-primary" style={{ padding: '0.2rem 0.6rem', fontSize: '0.8rem', borderRadius: '6px' }}>
                                    Confirm
                                </button>
                            )}

                            {confirmingAdjust === item.id && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(0,0,0,0.3)', padding: '0.5rem', borderRadius: '8px', zIndex: 10 }}>
                                    <select value={adjustCook} onChange={(e) => setAdjustCook(e.target.value)} style={{ padding: '0.3rem', borderRadius: '4px', background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid rgba(255,255,255,0.2)', fontSize: '0.85rem' }}>
                                        <option value="">Select Cook...</option>
                                        {prepUsers.map(user => (
                                            <option key={user.id} value={user.id}>{user.name}</option>
                                        ))}
                                    </select>
                                    <button onClick={() => handleConfirmAdjustSubmit(item)} className="btn-primary" style={{ padding: '0.3rem', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Submit Adjustment">
                                        <Check size={16} />
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem' }}>
                        <div style={{ fontSize: '1.75rem', fontWeight: 700, lineHeight: 1, color: adj !== 0 ? 'var(--accent-primary)' : 'inherit' }}>{adj !== 0 ? totalWithAdj : item.total}</div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '1.1rem', fontWeight: 500 }}>{getOptName(item.metric)}</div>
                    </div>
                </div>
            </div>
        );
    };

    const renderSection = (type: 'RAW' | 'PROCESSED', catFilter: string, ingFilter: string) => {
        let items = filteredInventory.filter(i => i.type === type);
        if (catFilter) items = items.filter(i => i.category === catFilter);
        if (ingFilter) items = items.filter(i => i.name === ingFilter);

        const grouped = items.reduce((acc, item) => {
            if (!acc[item.category]) acc[item.category] = [];
            acc[item.category].push(item);
            return acc;
        }, {} as Record<string, Ingredient[]>);

        const sortedCategories = Object.keys(grouped).sort();

        if (items.length === 0) return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>No items found.</div>;

        return (
            <div style={{ display: 'flex', flexDirection: 'column', marginTop: '2.5rem', position: 'relative', zIndex: 0 }}>
                {sortedCategories.map(cat => (
                    <div key={cat} style={{ display: 'flex', flexDirection: 'column', marginBottom: '2rem' }}>
                        <h3 style={{ fontSize: '1.25rem', fontWeight: 600, opacity: 0.8, color: 'var(--text-secondary)', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.5rem', marginBottom: '1.5rem', marginTop: 0 }}>
                            {getOptName(cat)}
                        </h3>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem' }}>
                            {grouped[cat].sort((a, b) => a.name.localeCompare(b.name)).map(item => renderIngredientBox(item))}
                        </div>
                    </div>
                ))}
            </div>
        );
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h1 style={{ fontSize: '2.5rem', marginBottom: '0.25rem' }}>{t('title')}</h1>
                    <p style={{ color: 'var(--text-secondary)' }}>{t('ingredients_tracked', { count: dbIngredients.length })}</p>
                </div>
                <div style={{ display: 'flex', gap: '1rem' }}>
                    {activeTab === 'ALL_INGREDIENTS' && (
                        <button className="btn-secondary" onClick={() => setIsManageOptionsOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderRadius: '8px', padding: '0.6rem 1rem', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>
                            <Settings size={18} />
                            <span>{t('manage_options')}</span>
                        </button>
                    )}
                    <button className="btn-primary" onClick={() => {
                        if (activeTab === 'CATEGORIES') {
                            if (categoryTab === 'CATEGORIES') {
                                setIsManageOptionsOpen(true);
                            } else {
                                handleAddProvider();
                            }
                        } else if (activeTab === 'PREP_RECIPES') {
                            setEditingIngredient(null);
                            setIsRecipeModalOpen(true);
                        } else {
                            setEditingIngredient(null);
                            setIsAddModalOpen(true);
                        }
                    }} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderRadius: '8px', padding: '0.6rem 1rem' }}>
                        <Plus size={18} />
                        <span>{activeTab === 'PRODUCTION' ? t('add_production') : activeTab === 'PREP_RECIPES' ? (locale === 'es' ? 'Añadir Receta' : 'Add Prep Recipe') : activeTab === 'CATEGORIES' ? (categoryTab === 'CATEGORIES' ? (locale === 'es' ? 'Gestionar Categorías' : 'Manage Categories') : (locale === 'es' ? 'Añadir Proveedor' : 'Add Supplier')) : t('add_ingredient')}</span>
                    </button>
                </div>
            </div>

            {/* Controls Container */}
            <div className="glass-panel" style={{ padding: '1rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>

                {/* Tabs */}
                <div style={{ display: 'flex', gap: '0.5rem', background: 'rgba(0,0,0,0.2)', padding: '0.3rem', borderRadius: '12px' }}>
                    {[
                        { id: 'ALL', label: locale === 'es' ? 'Inventario' : 'Inventory' },
                        { id: 'ALL_INGREDIENTS', label: locale === 'es' ? 'Ingredientes' : 'Ingredients' },
                        { id: 'PREP_RECIPES', label: locale === 'es' ? 'Recetas' : 'Recipes' },
                        { id: 'CATEGORIES', label: locale === 'es' ? 'Categorías y Proveedores' : 'Categories & Suppliers' }
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as any)}
                            style={{
                                padding: '0.5rem 1rem',
                                borderRadius: '8px',
                                fontWeight: 500,
                                fontSize: '0.9rem',
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

            {/* Main View */}
            {activeTab === 'ALL' && (
                <div style={{ marginTop: '2.5rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>

                    {lastSyncTime && (
                        <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem 1rem', background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.2)', borderRadius: '8px' }}>
                            <span>Last Clover Sync: {new Date(lastSyncTime).toLocaleString()}</span>
                            <button onClick={handleSyncClover} disabled={isSyncing} className="btn-secondary" style={{ padding: '0.3rem 0.8rem', fontSize: '0.8rem' }}>{isSyncing ? 'Syncing...' : 'Sync Now'}</button>
                        </div>
                    )}

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '1rem', marginBottom: '1rem' }}>
                        <button onClick={() => setOverviewTab('FREEZER')} className={overviewTab === 'FREEZER' ? 'btn-primary' : ''} style={{ padding: '0.5rem 1.5rem', borderRadius: '8px', border: overviewTab === 'FREEZER' ? 'none' : '1px solid var(--glass-border)', color: overviewTab === 'FREEZER' ? 'white' : 'var(--text-secondary)' }}>Control de Congelados</button>
                        <button onClick={() => setOverviewTab('RAW')} className={overviewTab === 'RAW' ? 'btn-primary' : ''} style={{ padding: '0.5rem 1.5rem', borderRadius: '8px', border: overviewTab === 'RAW' ? 'none' : '1px solid var(--glass-border)', color: overviewTab === 'RAW' ? 'white' : 'var(--text-secondary)' }}>{t('raw_ingredients')}</button>
                        <button onClick={() => setOverviewTab('PROCESSED')} className={overviewTab === 'PROCESSED' ? 'btn-primary' : ''} style={{ padding: '0.5rem 1.5rem', borderRadius: '8px', border: overviewTab === 'PROCESSED' ? 'none' : '1px solid var(--glass-border)', color: overviewTab === 'PROCESSED' ? 'white' : 'var(--text-secondary)' }}>{t('processed_food')}</button>
                        <button onClick={() => setOverviewTab('RELATIONSHIPS')} className={overviewTab === 'RELATIONSHIPS' ? 'btn-primary' : ''} style={{ padding: '0.5rem 1.5rem', borderRadius: '8px', border: overviewTab === 'RELATIONSHIPS' ? 'none' : '1px solid var(--glass-border)', color: overviewTab === 'RELATIONSHIPS' ? 'white' : 'var(--text-secondary)' }}>Ingredient Relationships</button>
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2rem', marginTop: '2rem', width: '100%', alignItems: 'flex-start' }}>
                        {overviewTab === 'FREEZER' && (
                            <div style={{ flex: 1, minWidth: '100%', display: 'flex', flexDirection: 'column', overflowX: 'auto' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', position: 'relative', zIndex: 60, marginBottom: '1.5rem' }}>
                                    <h2 style={{ fontSize: '1.5rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>Control de Congelados</h2>
                                    <p style={{ color: 'var(--text-secondary)', margin: '-0.5rem 0 0.5rem 0', fontSize: '0.9rem' }}>Tracker mainly for stored prep and Processed Foods evaluating freezer vs fridge.</p>
                                </div>
                                <div className="glass-panel" style={{ padding: '0', overflowX: 'auto' }}>
                                    <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse', minWidth: '800px' }}>
                                        <thead>
                                            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-secondary)' }}>
                                                <th style={{ padding: '1rem', fontWeight: 500 }}>{locale === 'es' ? 'Nombre' : 'Name'}</th>
                                                <th style={{ padding: '1rem', fontWeight: 500, textAlign: 'center' }}>{locale === 'es' ? 'Stock Total' : 'Total Stock'}</th>
                                                <th style={{ padding: '1rem', fontWeight: 500, textAlign: 'center', color: '#60a5fa' }}>{locale === 'es' ? 'Congelado ❄️' : 'Frozen ❄️'}</th>
                                                <th style={{ padding: '1rem', fontWeight: 500, textAlign: 'center', color: 'var(--warning)' }}>{locale === 'es' ? 'Descongelado 🌡️' : 'Unfrozen 🌡️'}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredInventory.filter(i => (i.type === 'PROCESSED' || i.type === 'PREP_RECIPE') && i.trackFreezerStatus).sort((a, b) => a.name.localeCompare(b.name)).map(item => {
                                                const baseUnfrozen = item.unfrozenQuantity || 0;
                                                const draftVal = draftUnfrozen[item.id];
                                                const hasDraft = draftVal !== undefined && draftVal !== baseUnfrozen;
                                                const displayUnfrozen = draftVal !== undefined ? draftVal : baseUnfrozen;

                                                const totalStock = item.total || 0;
                                                const frozenAmt = Math.max(0, totalStock - displayUnfrozen);

                                                return (
                                                    <tr key={item.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                                        <td style={{ padding: '1rem', fontWeight: 'bold' }}>
                                                            {item.name}
                                                            {item.providerName && <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 'normal' }}>{item.providerName}</span>}
                                                        </td>
                                                        <td style={{ padding: '1rem', textAlign: 'center', fontSize: '1.1rem', fontWeight: 600 }}>{totalStock} <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 'normal' }}>{item.metric}</span></td>
                                                        <td style={{ padding: '1rem', textAlign: 'center', fontSize: '1.1rem', color: '#60a5fa', fontWeight: 600 }}>{frozenAmt}</td>
                                                        <td style={{ padding: '1rem', textAlign: 'center' }}>
                                                            <div style={{ display: 'inline-flex', gap: '1rem', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '0.5rem 1rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                                                                <button onClick={() => setDraftUnfrozen(prev => ({ ...prev, [item.id]: Math.max(0, displayUnfrozen - 1) }))} className="btn-primary" style={{ width: '32px', height: '32px', borderRadius: '50%', padding: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', border: 'none', background: 'var(--danger)', opacity: displayUnfrozen <= 0 ? 0.3 : 1, cursor: displayUnfrozen <= 0 ? 'not-allowed' : 'pointer' }} disabled={displayUnfrozen <= 0}>
                                                                    <Minus size={16} />
                                                                </button>
                                                                <span style={{ fontWeight: 'bold', fontSize: '1.2rem', minWidth: '30px', textAlign: 'center', color: 'var(--warning)' }}>{displayUnfrozen}</span>
                                                                <button onClick={() => setDraftUnfrozen(prev => ({ ...prev, [item.id]: displayUnfrozen + 1 }))} className="btn-primary" style={{ width: '32px', height: '32px', borderRadius: '50%', padding: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', border: 'none', background: 'var(--success)', cursor: 'pointer' }}>
                                                                    <Plus size={16} />
                                                                </button>

                                                                {hasDraft && (
                                                                    <button onClick={() => handleConfirmUnfrozen(item)} className="btn-primary" style={{ marginLeft: '1rem', padding: '0.3rem 0.8rem', fontSize: '0.85rem', background: '#3b82f6', border: 'none', borderRadius: '6px', color: 'white', display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                                                                        <Check size={14} />
                                                                        {locale === 'es' ? 'Confirmar' : 'Confirm'}
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {overviewTab === 'RAW' && (
                            <div style={{ flex: 1, minWidth: '350px', display: 'flex', flexDirection: 'column' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', position: 'relative', zIndex: 50, marginBottom: '1.5rem' }}>
                                    <h2 style={{ fontSize: '1.5rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>{t('raw_ingredients')}</h2>
                                    <div style={{ display: 'flex', flexWrap: 'nowrap', gap: '1rem', width: '100%' }}>
                                        <SearchableSelect
                                            value={rawCategoryFilter}
                                            onChange={(val) => {
                                                setRawCategoryFilter(val);
                                                setRawIngredientFilter('');
                                            }}
                                            placeholder="All Categories"
                                            options={[{ value: '', label: 'All Categories' }, ...Array.from(new Set(filteredInventory.filter(i => i.type === 'RAW').map(i => i.category))).sort((a, b) => a.localeCompare(b)).map(c => ({ value: c, label: getOptName(c) }))]}
                                            wrapperStyle={{ flex: 1, minWidth: '150px' }}
                                        />
                                        <SearchableSelect
                                            value={rawIngredientFilter}
                                            onChange={(val) => setRawIngredientFilter(val)}
                                            placeholder="All Ingredients"
                                            options={[{ value: '', label: 'All Ingredients' }, ...Array.from(new Set(filteredInventory.filter(i => i.type === 'RAW' && (!rawCategoryFilter || i.category === rawCategoryFilter)).map(i => i.name))).sort((a, b) => a.localeCompare(b)).map(n => ({ value: n, label: n }))]}
                                            wrapperStyle={{ flex: 1, minWidth: '150px' }}
                                        />
                                    </div>
                                </div>
                                {renderSection('RAW', rawCategoryFilter, rawIngredientFilter)}
                            </div>
                        )}

                        {overviewTab === 'PROCESSED' && (
                            <div style={{ flex: 1, minWidth: '350px', display: 'flex', flexDirection: 'column' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', position: 'relative', zIndex: 40, marginBottom: '1.5rem' }}>
                                    <h2 style={{ fontSize: '1.5rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>{t('processed_food')}</h2>
                                    <div style={{ display: 'flex', flexWrap: 'nowrap', gap: '1rem', width: '100%' }}>
                                        <SearchableSelect
                                            value={processedCategoryFilter}
                                            onChange={(val) => {
                                                setProcessedCategoryFilter(val);
                                                setProcessedIngredientFilter('');
                                            }}
                                            placeholder="All Categories"
                                            options={[{ value: '', label: 'All Categories' }, ...Array.from(new Set(filteredInventory.filter(i => i.type === 'PROCESSED').map(i => i.category))).sort((a, b) => a.localeCompare(b)).map(c => ({ value: c, label: getOptName(c) }))]}
                                            wrapperStyle={{ flex: 1, minWidth: '150px' }}
                                        />
                                        <SearchableSelect
                                            value={processedIngredientFilter}
                                            onChange={(val) => setProcessedIngredientFilter(val)}
                                            placeholder="All Ingredients"
                                            options={[{ value: '', label: 'All Ingredients' }, ...Array.from(new Set(filteredInventory.filter(i => i.type === 'PROCESSED' && (!processedCategoryFilter || i.category === processedCategoryFilter)).map(i => i.name))).sort((a, b) => a.localeCompare(b)).map(n => ({ value: n, label: n }))]}
                                            wrapperStyle={{ flex: 1, minWidth: '150px' }}
                                        />
                                    </div>
                                </div>
                                {renderSection('PROCESSED', processedCategoryFilter, processedIngredientFilter)}
                            </div>
                        )}
                        {overviewTab === 'RELATIONSHIPS' && (
                            <div style={{ flex: 1, minWidth: '350px', display: 'flex', flexDirection: 'column' }}>
                                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
                                    <h2 style={{ fontSize: '1.5rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>Ingredient Relationships</h2>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                    {filteredInventory.filter(i => i.type === 'RAW').sort((a, b) => a.name.localeCompare(b.name)).map(parent => {
                                        const children = filteredInventory.filter(i => i.parent?.id === parent.id);
                                        return (
                                            <div key={parent.id} className="glass-panel" style={{ padding: '1rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                                    <strong>{parent.name}</strong>
                                                    <span style={{ color: 'var(--text-secondary)' }}>{parent.total} {getOptName(parent.metric)}</span>
                                                </div>
                                                {children.length > 0 && (
                                                    <div style={{ paddingLeft: '2rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem', borderLeft: '2px solid rgba(255,255,255,0.1)' }}>
                                                        {children.map(child => (
                                                            <div key={child.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
                                                                <span style={{ color: 'var(--accent-primary)' }}>↳ {child.name}</span>
                                                                <span style={{ color: 'var(--text-secondary)' }}>{child.total} {getOptName(child.metric)}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* activeTab === PRODUCTION block removed temporarily or handled manually if it was still there */}

            {activeTab === 'PRODUCTION' && (
                <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
                    <div style={{ padding: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                            <Calendar size={20} style={{ color: 'var(--accent-primary)' }} />
                            <h2 style={{ fontSize: '1.25rem', margin: 0 }}>Friday</h2>
                            <span style={{ color: 'var(--text-secondary)' }}>Feb 20, 2026</span>
                        </div>
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead>
                            <tr style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                                <th style={{ padding: '1rem 1.5rem', fontWeight: 500, color: 'var(--text-secondary)' }}>{t('name')}</th>
                                <th style={{ padding: '1rem 1.5rem', fontWeight: 500, color: 'var(--text-secondary)' }}>{t('to_produce')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {schedules.map((item, index) => (
                                <tr key={item.id} style={{
                                    borderBottom: index === schedules.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.05)',
                                }}>
                                    <td style={{ padding: '1rem 1.5rem', fontWeight: 500 }}>{item.name}</td>
                                    <td style={{ padding: '1rem 1.5rem' }}>
                                        <div style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '0.5rem',
                                            padding: '0.4rem 0.8rem',
                                            borderRadius: '8px',
                                            background: `color-mix(in srgb, var(--accent-primary) 20%, transparent)`,
                                            color: 'var(--accent-primary)',
                                            fontWeight: 700,
                                            border: `1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent)`
                                        }}>
                                            {item.targetAmount} {item.metric}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {activeTab === 'PREP_RECIPES' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                    <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                            <thead>
                                <tr style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                                    <th style={{ padding: '1rem 1.5rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Recipe Name</th>
                                    <th style={{ padding: '1rem 1.5rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Category</th>
                                    <th style={{ padding: '1rem 1.5rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Yield / Batch Size</th>
                                    <th style={{ padding: '1rem 1.5rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Cost per Batch</th>
                                    <th style={{ padding: '1rem 1.5rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Cost per Unit</th>
                                    <th style={{ padding: '1rem 1.5rem', fontWeight: 500, color: 'var(--text-secondary)', textAlign: 'right' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredInventory.filter(i => i.type === 'PREP_RECIPE').length === 0 ? (
                                    <tr>
                                        <td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>No prep recipes found. Click "Add Prep Recipe" to create one.</td>
                                    </tr>
                                ) : (
                                    filteredInventory.filter(i => i.type === 'PREP_RECIPE').map(item => (
                                        <tr key={item.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                            <td style={{ padding: '1rem 1.5rem', fontWeight: 600 }}>{item.name}</td>
                                            <td style={{ padding: '1rem 1.5rem', color: 'var(--text-secondary)' }}>{getOptName(item.category)}</td>
                                            <td style={{ padding: '1rem 1.5rem' }}>{item.portionWeightG || 1} {getOptName(item.metric)}</td>
                                            <td style={{ padding: '1rem 1.5rem', color: 'var(--success)' }}>${((item.calculatedCost || 0) * ((item.portionWeightG || 1) * (item.yieldPercent || 100) / 100)).toFixed(2)}</td>
                                            <td style={{ padding: '1rem 1.5rem', color: 'var(--text-secondary)' }}>${(item.calculatedCost || 0).toFixed(2)} / {getOptName(item.metric)}</td>
                                            <td style={{ padding: '1rem 1.5rem', textAlign: 'right' }}>
                                                <button onClick={() => { setEditingIngredient(item); setIsRecipeModalOpen(true); }} style={{ color: 'var(--accent-primary)', padding: '0.25rem 0.5rem', fontSize: '0.9rem', fontWeight: 500 }}>Edit</button>
                                                <button onClick={() => handleDeleteIngredient(item.id)} style={{ color: 'var(--danger)', padding: '0.25rem 0.5rem', fontSize: '0.9rem', fontWeight: 500, marginLeft: '1rem' }}>Delete</button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {activeTab === 'ALL_INGREDIENTS' && (
                <div style={{ marginTop: '2.5rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>

                    {/* Filters for ALL_INGREDIENTS */}
                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <SearchableSelect
                            value={allIngredientsCategoryFilter}
                            onChange={(val) => {
                                setAllIngredientsCategoryFilter(val);
                                setAllIngredientsNameFilter('');
                            }}
                            placeholder="All Categories"
                            options={[{ value: '', label: 'All Categories' }, ...Object.keys(groupedInventory).sort((a, b) => a.localeCompare(b)).map(c => ({ value: c, label: getOptName(c) }))]}
                            wrapperStyle={{ flex: 1, minWidth: '200px' }}
                        />
                        <SearchableSelect
                            value={allIngredientsNameFilter}
                            onChange={(val) => setAllIngredientsNameFilter(val)}
                            placeholder="All Ingredients"
                            options={[{ value: '', label: 'All Ingredients' }, ...Array.from(new Set(filteredInventory.filter(i => (!allIngredientsCategoryFilter || i.category === allIngredientsCategoryFilter) && (allIngredientsTypeFilter === 'ALL' || (allIngredientsTypeFilter === 'PARENT' ? !i.parent : i.parent))).map(i => i.name))).sort((a, b) => a.localeCompare(b)).map(n => ({ value: n, label: n }))]}
                            wrapperStyle={{ flex: 1, minWidth: '200px' }}
                        />
                        <SearchableSelect
                            value={allIngredientsTypeFilter}
                            onChange={(val) => setAllIngredientsTypeFilter(val as any)}
                            placeholder="All Types"
                            options={[
                                { value: 'ALL', label: 'Item Type: All' },
                                { value: 'PARENT', label: 'Parent Items Only' },
                                { value: 'CHILD', label: 'Child Items Only' }
                            ]}
                            wrapperStyle={{ flex: 1, minWidth: '200px' }}
                        />
                    </div>

                    {Object.entries(groupedInventory)
                        .filter(([category]) => !allIngredientsCategoryFilter || category === allIngredientsCategoryFilter)
                        .sort(([catA], [catB]) => catA.localeCompare(catB))
                        .map(([category, items]) => {
                            let filteredItems = items
                                .filter(i => !allIngredientsNameFilter || i.name === allIngredientsNameFilter)
                                .filter(i => allIngredientsTypeFilter === 'ALL' || (allIngredientsTypeFilter === 'PARENT' ? !i.parent : i.parent));

                            // 1. Separate all items into parents and children.
                            const rootItems = filteredItems.filter(i => !i.parent);
                            const childItems = filteredItems.filter(i => i.parent);

                            // 2. Sort the parent items (and children) alphabetically based on their localized names.
                            rootItems.sort((a, b) => a.name.localeCompare(b.name));
                            childItems.sort((a, b) => a.name.localeCompare(b.name));

                            // 3. Iterate through sorted parents and insert their specific child items immediately after them.
                            const finalSortedItems = [] as typeof items;
                            rootItems.forEach(parent => {
                                finalSortedItems.push(parent);
                                const childrenOfParent = childItems.filter(c => c.parent.id === parent.id);
                                finalSortedItems.push(...childrenOfParent);
                            });

                            // Ensure any orphan children (e.g., if parent was filtered out by a search text) are still rendered
                            const handledIds = new Set(finalSortedItems.map(i => i.id));
                            const orphanChildren = childItems.filter(c => !handledIds.has(c.id));
                            finalSortedItems.push(...orphanChildren);

                            filteredItems = finalSortedItems;

                            if (filteredItems.length === 0) return null;

                            return (
                                <div key={category} className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
                                    <div style={{ padding: '1rem 1.5rem', background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                                        <h3 style={{ fontSize: '1.2rem', fontWeight: 600, margin: 0 }}>{getOptName(category)}</h3>
                                    </div>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                                        <thead>
                                            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                                                <th style={{ padding: '1rem 1.5rem', fontWeight: 500, color: 'var(--text-secondary)', width: '120px' }}>{t('total')}</th>
                                                <th style={{ padding: '1rem 1.5rem', fontWeight: 500, color: 'var(--text-secondary)' }}>{t('name')}</th>
                                                <th style={{ padding: '1rem 1.5rem', fontWeight: 500, color: 'var(--text-secondary)' }}>{t('type')}</th>
                                                <th style={{ padding: '1rem 1.5rem', fontWeight: 500, color: 'var(--text-secondary)' }}>{t('metric')}</th>
                                                <th style={{ padding: '1rem 1.5rem', fontWeight: 500, color: 'var(--text-secondary)' }}>{t('yield_percent') || 'Yield %'}</th>
                                                <th style={{ padding: '1rem 1.5rem', fontWeight: 500, color: 'var(--text-secondary)' }}>{locale === 'es' ? 'Merma %' : 'Waste %'}</th>
                                                <th style={{ padding: '1rem 1.5rem', fontWeight: 500, color: 'var(--text-secondary)', textAlign: 'right' }}>{t('actions')}</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredItems.map((item, index) => (
                                                <tr key={item.id} style={{
                                                    borderBottom: index === items.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.05)',
                                                    transition: 'background 0.2s',
                                                }}
                                                    onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                                                    onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}>
                                                    <td style={{ padding: '1rem 1.5rem' }}>
                                                        <div style={{
                                                            display: 'inline-block',
                                                            padding: '0.4rem 0.8rem',
                                                            borderRadius: '8px',
                                                            background: `color-mix(in srgb, ${getStatusColor(item.status)} 20%, transparent)`,
                                                            color: getStatusColor(item.status),
                                                            fontWeight: 700,
                                                            fontSize: '1.1rem',
                                                            border: `1px solid color-mix(in srgb, ${getStatusColor(item.status)} 30%, transparent)`
                                                        }}>
                                                            {item.total}
                                                        </div>
                                                    </td>
                                                    <td style={{ padding: '1rem 1.5rem', paddingLeft: item.parent ? 'calc(1.5rem + 24px)' : '1.5rem', fontWeight: item.parent ? 400 : 700, color: item.parent ? 'var(--text-secondary)' : 'var(--text-primary)' }}>
                                                        {item.parent && <span style={{ marginRight: '8px', opacity: 0.5 }}>└</span>}
                                                        {item.name}
                                                    </td>
                                                    <td style={{ padding: '1rem 1.5rem' }}>
                                                        <span style={{
                                                            padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600,
                                                            background: item.type === 'RAW' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(139, 92, 246, 0.2)',
                                                            color: item.type === 'RAW' ? 'var(--accent-primary)' : 'var(--accent-secondary)'
                                                        }}>
                                                            {getOptName(item.type)}
                                                        </span>
                                                    </td>
                                                    <td style={{ padding: '1rem 1.5rem', color: 'var(--text-secondary)' }}>
                                                        <span style={{ background: 'rgba(255,255,255,0.1)', padding: '0.2rem 0.6rem', borderRadius: '6px', fontSize: '0.85rem' }}>
                                                            {getOptName(item.metric)}
                                                        </span>
                                                    </td>
                                                    <td style={{ padding: '1rem 1.5rem', color: 'var(--text-secondary)' }}>
                                                        {item.yieldPercent ? `${item.yieldPercent}%` : '100%'}
                                                    </td>
                                                    <td style={{ padding: '1rem 1.5rem', color: 'var(--text-secondary)' }}>
                                                        {item.yieldPercent ? `${parseFloat((100 - (item.yieldPercent as number)).toFixed(2))}%` : '0%'}
                                                    </td>
                                                    <td style={{ padding: '1rem 1.5rem', textAlign: 'right' }}>
                                                        {item.type === 'RAW' && !item.parent && (
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setEditingIngredient(item);
                                                                    setIsAddModalOpen(true);
                                                                }}
                                                                style={{
                                                                    marginRight: '0.8rem',
                                                                    color: 'var(--accent-primary)',
                                                                    background: 'rgba(59,130,246,0.1)',
                                                                    padding: '0.2rem 0.5rem',
                                                                    borderRadius: '6px',
                                                                    fontSize: '0.75rem'
                                                                }}
                                                                title="Manage Market Source"
                                                            >
                                                                🔗 Source
                                                            </button>
                                                        )}
                                                        <button onClick={() => { setEditingIngredient(item); setIsAddModalOpen(true); }} style={{ color: 'var(--accent-primary)', padding: '0.25rem 0.5rem', fontSize: '0.9rem', fontWeight: 500 }}>
                                                            Edit
                                                        </button>
                                                        <button onClick={() => handleDeleteIngredient(item.id)} style={{ color: 'var(--danger)', padding: '0.25rem 0.5rem', fontSize: '0.9rem', fontWeight: 500, marginLeft: '1rem' }}>
                                                            Delete
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )
                        })}
                </div>
            )
            }

            {
                activeTab === 'CATEGORIES' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                        <div style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '1rem' }}>
                            <button onClick={() => setCategoryTab('CATEGORIES')} className={categoryTab === 'CATEGORIES' ? 'btn-primary' : ''} style={{ padding: '0.5rem 1.5rem', borderRadius: '8px', border: categoryTab === 'CATEGORIES' ? 'none' : '1px solid var(--glass-border)', color: categoryTab === 'CATEGORIES' ? 'white' : 'var(--text-secondary)' }}>{locale === 'es' ? 'Categorías' : 'Categories'}</button>
                            <button onClick={() => setCategoryTab('PROVEEDORES')} className={categoryTab === 'PROVEEDORES' ? 'btn-primary' : ''} style={{ padding: '0.5rem 1.5rem', borderRadius: '8px', border: categoryTab === 'PROVEEDORES' ? 'none' : '1px solid var(--glass-border)', color: categoryTab === 'PROVEEDORES' ? 'white' : 'var(--text-secondary)' }}>{locale === 'es' ? 'Proveedores' : 'Suppliers'}</button>
                        </div>

                        {categoryTab === 'CATEGORIES' && (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '2rem' }}>
                                {/* Render DB Categories grouped by department */}
                                {Object.entries(
                                    dbCategories.reduce((acc, cat) => {
                                        if (!acc[cat.department]) acc[cat.department] = [];
                                        acc[cat.department].push(cat);
                                        return acc;
                                    }, {} as Record<string, any[]>)
                                ).map(([dept, categoriesArray]) => {
                                    const categories = categoriesArray as any[];
                                    const deptColors = dept === 'FOOD' ? { bg: 'rgba(59, 130, 246, 0.2)', text: 'var(--accent-primary)' } :
                                        dept === 'DRINKS' ? { bg: 'rgba(245, 158, 11, 0.2)', text: 'var(--warning)' } :
                                            dept === 'CLEANING' ? { bg: 'rgba(16, 185, 129, 0.2)', text: 'var(--success)' } :
                                                { bg: 'rgba(255, 255, 255, 0.1)', text: 'var(--text-primary)' };
                                    return (
                                        <div key={dept} className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', padding: '1.5rem' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '1rem' }}>
                                                <h2 style={{ fontSize: '1.25rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                    <span style={{
                                                        display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%',
                                                        backgroundColor: deptColors.text, boxShadow: `0 0 8px ${deptColors.text}`
                                                    }}></span>
                                                    {dept}
                                                </h2>
                                                <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{categories.length} categories</span>
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                                {categories.sort((a, b) => a.name.localeCompare(b.name)).map((category: any) => {
                                                    const isExpanded = expandedCategories.has(category.id);
                                                    const categoryIngredients = filteredInventory.filter(i => i.rawCategory === category.name);
                                                    return (
                                                        <div key={category.id} style={{
                                                            display: 'flex', flexDirection: 'column',
                                                            background: 'rgba(0,0,0,0.2)', borderRadius: '8px',
                                                            border: '1px solid rgba(255,255,255,0.03)',
                                                            overflow: 'hidden'
                                                        }}>
                                                            <div
                                                                onClick={() => toggleCategoryExpand(category.id)}
                                                                style={{
                                                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                                    padding: '0.75rem 1rem', cursor: 'pointer',
                                                                    background: isExpanded ? 'rgba(255,255,255,0.05)' : 'transparent',
                                                                    transition: 'background 0.2s'
                                                                }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                                    <div style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center' }}>
                                                                        {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                                                                    </div>
                                                                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                                        <span style={{ fontWeight: 500 }}>{category.name}</span>
                                                                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{category._count.ingredients} items linked</span>
                                                                    </div>
                                                                </div>
                                                                <div style={{ display: 'flex', gap: '0.5rem', color: 'var(--text-secondary)' }} onClick={(e) => e.stopPropagation()}>
                                                                    <button style={{ color: 'inherit', padding: '0.25rem' }} onMouseOver={(e) => e.currentTarget.style.color = 'var(--text-primary)'} onMouseOut={(e) => e.currentTarget.style.color = 'inherit'}><Pencil size={16} /></button>
                                                                    <button onClick={() => handleDeleteCategory(category.id)} style={{ color: 'var(--danger)', padding: '0.25rem' }}><Trash2 size={16} /></button>
                                                                </div>
                                                            </div>
                                                            {isExpanded && (
                                                                <div style={{ background: 'rgba(255,255,255,0.02)', borderTop: '1px solid rgba(255,255,255,0.05)', padding: '1rem' }}>
                                                                    {categoryIngredients.length === 0 ? (
                                                                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', textAlign: 'center', padding: '1rem 0' }}>
                                                                            {locale === 'es' ? 'No hay ingredientes en esta categoría' : 'No ingredients in this category'}
                                                                        </div>
                                                                    ) : (
                                                                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
                                                                            <thead>
                                                                                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-secondary)' }}>
                                                                                    <th style={{ padding: '0.5rem', fontWeight: 500 }}>{locale === 'es' ? 'Ingrediente' : 'Ingredient'}</th>
                                                                                    <th style={{ padding: '0.5rem', fontWeight: 500, textAlign: 'right' }}>{locale === 'es' ? 'Stock' : 'Stock'}</th>
                                                                                    <th style={{ padding: '0.5rem', fontWeight: 500 }}>{locale === 'es' ? 'Unidad' : 'Metric'}</th>
                                                                                </tr>
                                                                            </thead>
                                                                            <tbody>
                                                                                {categoryIngredients.sort((a, b) => a.name.localeCompare(b.name)).map(ing => (
                                                                                    <tr key={ing.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)' }}>
                                                                                        <td style={{ padding: '0.5rem' }}>
                                                                                            <button
                                                                                                onClick={(e) => { e.stopPropagation(); setEditingIngredient(ing); setIsAddModalOpen(true); }}
                                                                                                style={{ color: 'var(--accent-primary)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 500, textAlign: 'left', textDecoration: 'none' }}
                                                                                                onMouseOver={(e) => e.currentTarget.style.textDecoration = 'underline'}
                                                                                                onMouseOut={(e) => e.currentTarget.style.textDecoration = 'none'}
                                                                                            >
                                                                                                {ing.name}
                                                                                            </button>
                                                                                        </td>
                                                                                        <td style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 600 }}>{ing.total}</td>
                                                                                        <td style={{ padding: '0.5rem', color: 'var(--text-secondary)' }}>{typeof getOptName === 'function' ? getOptName(ing.metric) : ing.metric}</td>
                                                                                    </tr>
                                                                                ))}
                                                                            </tbody>
                                                                        </table>
                                                                    )}
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
                        {categoryTab === 'PROVEEDORES' && (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '2rem' }}>
                                <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', padding: '1.5rem', gridColumn: '1 / -1' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '1rem' }}>
                                        <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>{locale === 'es' ? 'Lista de Proveedores' : 'Supplier List'}</h2>
                                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{dbProviders.length} providers</span>
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
                                        {dbProviders.sort((a, b) => a.name.localeCompare(b.name)).map((prov: any) => (
                                            <div key={prov.id} style={{
                                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                padding: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '8px',
                                                border: '1px solid rgba(255,255,255,0.03)'
                                            }}>
                                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                    <span style={{ fontWeight: 500, fontSize: '1.1rem' }}>{prov.name}</span>
                                                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{prov._count?.ingredients || 0} items linked</span>
                                                </div>
                                                <div style={{ display: 'flex', gap: '0.5rem', color: 'var(--text-secondary)' }}>
                                                    <button onClick={() => handleEditProvider(prov.id, prov.name)} style={{ color: 'inherit', padding: '0.4rem', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px' }} onMouseOver={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.3)'; }} onMouseOut={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }}><Pencil size={16} /></button>
                                                    <button onClick={() => handleDeleteProvider(prov.id)} style={{ color: 'var(--danger)', padding: '0.4rem', border: '1px solid rgba(220, 38, 38, 0.2)', borderRadius: '6px' }} onMouseOver={(e) => e.currentTarget.style.background = 'rgba(220, 38, 38, 0.1)'} onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}><Trash2 size={16} /></button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )
            }

            <AddIngredientModal
                isOpen={isAddModalOpen}
                onClose={() => {
                    setIsAddModalOpen(false);
                    setEditingIngredient(null);
                }}
                onSave={handleSaveIngredient}
                initialData={editingIngredient}
            />
            <ManageOptionsModal
                isOpen={isManageOptionsOpen}
                onClose={() => {
                    setIsManageOptionsOpen(false);
                    loadData();
                }}
            />

            {isRecipeModalOpen && (
                <RecipeBuilderModal
                    isOpen={isRecipeModalOpen}
                    onClose={() => {
                        setIsRecipeModalOpen(false);
                        setEditingIngredient(null);
                    }}
                    initialData={editingIngredient}
                    onSave={async () => {
                        setIsRecipeModalOpen(false);
                        setEditingIngredient(null);
                        loadData();
                    }}
                    dbIngredients={dbIngredients}
                />
            )}
        </div >
    );
}
