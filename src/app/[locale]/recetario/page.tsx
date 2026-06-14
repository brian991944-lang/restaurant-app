'use client';

import React, { useState, useEffect } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useAdmin } from '@/components/AdminContext';
import { BookOpen, Plus, FileText, Check, Pencil, Trash2, History, X, Save, ArrowLeft, Search, Upload, Image as ImageIcon, GripVertical } from 'lucide-react';
import { DndContext, closestCenter, PointerSensor, DragOverlay, useSensor, useSensors } from '@dnd-kit/core';
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getDigitalRecipes, createDigitalRecipe, updateDigitalRecipe, getRecipeHistory, deleteDigitalRecipe, getAvailablePrepRecipes, suggestNextRecipeCode, isRecipeCodeAvailable } from '@/app/actions/recetario';
import { getCategories } from '@/app/actions/inventory';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import ManageOptionsModal from '@/components/modals/ManageOptionsModal';
import { supabase } from '@/lib/supabase';
import ImageUpload from '@/components/ui/ImageUpload';

interface RecipeIngredient {
    ingredient: string;
    quantity: string;
    metric: string;
    notes: string;
}

function SortableProcedureStep({ id, idx, step, isEditing, updateProcedure, removeProcedureRow, renderBoldText }: {
    id: string;
    idx: number;
    step: string;
    isEditing: boolean;
    updateProcedure: (index: number, val: string) => void;
    removeProcedureRow: (index: number) => void;
    renderBoldText: (text: string) => React.ReactNode;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
    const style: React.CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        display: 'flex',
        gap: '1rem',
        alignItems: 'flex-start',
        cursor: isEditing ? 'grab' : 'default',
    };
    return (
        <div ref={setNodeRef} style={style} {...attributes} {...(isEditing ? listeners : {})}>
            {isEditing && (
                <div style={{ color: 'var(--text-secondary)', flexShrink: 0, marginTop: '6px' }}>
                    <GripVertical size={18} />
                </div>
            )}
            <div style={{ background: 'var(--accent-primary)', color: 'white', width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '0.9rem', flexShrink: 0, marginTop: '2px' }}>
                {idx + 1}
            </div>
            <div style={{ flex: 1 }}>
                {isEditing ? (
                    <div style={{ display: 'flex', gap: '0.5rem' }} onPointerDown={(e) => e.stopPropagation()}>
                        <textarea value={step} onChange={e => updateProcedure(idx, e.target.value)} rows={2} style={{ width: '100%', background: 'transparent', border: '1px solid var(--border)', padding: '0.5rem', color: 'var(--text-primary)', resize: 'vertical' }} />
                        <button onClick={() => removeProcedureRow(idx)} style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: '0.5rem' }}><X size={16} /></button>
                    </div>
                ) : (
                    <p style={{ margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{renderBoldText(step)}</p>
                )}
            </div>
        </div>
    );
}

function SortableIngredientModule({ id, groupName, items, showHeader, activeLinkedId, activeMultiplier, locale, getOptName, updateIngredient, updateLinkedIngredientNote, removeIngredientRow, ingrList }: {
    id: string;
    groupName: string;
    items: any[];
    showHeader: boolean;
    activeLinkedId?: string;
    activeMultiplier: number;
    locale: string;
    getOptName: (name: string) => string;
    updateIngredient: (index: number, field: string, val: string) => void;
    updateLinkedIngredientNote: (ingredientName: string, val: string, currentList: any[]) => void;
    removeIngredientRow: (index: number) => void;
    ingrList: any[];
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
    const style: React.CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        marginBottom: '2rem',
        cursor: 'grab',
    };
    return (
        <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
            {showHeader && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.8rem', paddingBottom: '0.3rem', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ color: 'var(--text-secondary)', flexShrink: 0 }}>
                        <GripVertical size={18} />
                    </div>
                    <h4 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--accent-primary)', margin: 0 }}>
                        {groupName}
                    </h4>
                </div>
            )}
            <div
                className="glass-panel"
                style={{ padding: '0.5rem', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)' }}
                onPointerDown={(e) => e.stopPropagation()}
            >
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                            <th style={{ padding: '0.5rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{locale === 'es' ? 'Ingrediente' : 'Ingredient'}</th>
                            <th style={{ padding: '0.5rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{locale === 'es' ? 'Cantidad' : 'Quantity'}</th>
                            <th style={{ padding: '0.5rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{locale === 'es' ? 'U. de Medida' : 'Metric'}</th>
                            <th style={{ padding: '0.5rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{locale === 'es' ? 'Notas' : 'Notes'}</th>
                            <th style={{ padding: '0.5rem', width: '40px' }}></th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map((ingr: any, localIdx: number) => {
                            const idx = ingr.originalIndex;
                            return (
                                <tr key={idx} style={{ borderBottom: '1px solid var(--border)', background: localIdx % 2 === 0 ? 'rgba(0,0,0,0.15)' : 'transparent' }}>
                                    {activeLinkedId ? (
                                        <>
                                            <td style={{ padding: '0.8rem 0.5rem', fontWeight: 500 }}>{ingr.ingredient}</td>
                                            <td style={{ padding: '0.8rem 0.5rem' }}>{ingr.quantity}</td>
                                            <td style={{ padding: '0.8rem 0.5rem' }}>{getOptName(ingr.metric)}</td>
                                            <td style={{ padding: '0.4rem' }}><textarea value={ingr.notes} onChange={e => updateLinkedIngredientNote(ingr.ingredient, e.target.value, ingrList)} rows={2} style={{ width: '100%', padding: '0.4rem', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-primary)', resize: 'vertical' }} /></td>
                                            <td style={{ padding: '0.4rem', textAlign: 'center' }}></td>
                                        </>
                                    ) : (
                                        <>
                                            <td style={{ padding: '0.4rem' }}><textarea value={ingr.ingredient} onChange={e => updateIngredient(idx, 'ingredient', e.target.value)} rows={2} style={{ width: '100%', padding: '0.4rem', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-primary)', resize: 'vertical' }} /></td>
                                            <td style={{ padding: '0.4rem' }}><input value={ingr.quantity} onChange={e => updateIngredient(idx, 'quantity', e.target.value)} style={{ width: '100%', padding: '0.4rem', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-primary)' }} /></td>
                                            <td style={{ padding: '0.4rem' }}><input value={ingr.metric} onChange={e => updateIngredient(idx, 'metric', e.target.value)} style={{ width: '100%', padding: '0.4rem', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-primary)' }} /></td>
                                            <td style={{ padding: '0.4rem' }}><textarea value={ingr.notes} onChange={e => updateIngredient(idx, 'notes', e.target.value)} rows={2} style={{ width: '100%', padding: '0.4rem', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-primary)', resize: 'vertical' }} /></td>
                                            <td style={{ padding: '0.4rem', textAlign: 'center' }}><button onClick={() => removeIngredientRow(idx)} style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer' }}><X size={16} /></button></td>
                                        </>
                                    )}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export default function RecetarioPage() {
    const locale = useLocale();
    const { isAdmin } = useAdmin();

    const [recipes, setRecipes] = useState<any[]>([]);
    const [activeTab, setActiveTab] = useState('RECETA'); // RECETA, EMPLATADO, GUIA
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [batchMultiplier, setBatchMultiplier] = useState<number | string>(1);
    const activeMultiplier = typeof batchMultiplier === 'number' && batchMultiplier >= 1 ? batchMultiplier : 1;

    const tOptions = useTranslations('Options');
    const getOptName = (name: string) => {
        if (!name) return name;
        try {
            const translated = tOptions(name as any);
            if (translated && translated.includes('Options.')) return name;
            return translated || name;
        } catch { return name; }
    };

    const [selectedRecipe, setSelectedRecipe] = useState<any>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [historyLogs, setHistoryLogs] = useState<any[]>([]);

    const [availablePreps, setAvailablePreps] = useState<any[]>([]);
    const [categories, setCategories] = useState<any[]>([]);
    const [isManageCategoriesOpen, setIsManageCategoriesOpen] = useState(false);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

    // Editor state
    const [editData, setEditData] = useState<any>(null);


    useEffect(() => {
        loadData();
    }, []);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
    );

    const [activeDragStep, setActiveDragStep] = useState<{ id: string; step: string; idx: number } | null>(null);
    const [procSteps, setProcSteps] = useState<Array<{ id: string; text: string }>>(() => {
        try {
            const parsed = JSON.parse(editData?.procedureJson || '[]') as string[];
            return parsed.map(text => ({ id: crypto.randomUUID(), text }));
        } catch {
            return [];
        }
    });

    // Reseed procSteps when the user switches to a different recipe.
    useEffect(() => {
        try {
            const parsed = JSON.parse(editData?.procedureJson || '[]') as string[];
            setProcSteps(prev =>
                parsed.map((text, i) => prev[i] && prev[i].text === text ? prev[i] : { id: crypto.randomUUID(), text })
            );
        } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedRecipe?.id]);

    const [moduleOrder, setModuleOrder] = useState<Array<{ id: string; groupName: string }>>(() => {
        try {
            const items = JSON.parse((editData ?? (selectedRecipe as any))?.ingredientsJson || '[]') as any[];
            const seen = new Set<string>();
            const groups: Array<{ id: string; groupName: string }> = [];
            for (const item of items) {
                const g = item.groupName || 'Main Components';
                if (!seen.has(g)) { seen.add(g); groups.push({ id: crypto.randomUUID(), groupName: g }); }
            }
            return groups;
        } catch { return []; }
    });

    useEffect(() => {
        try {
            const json = (editData ?? (selectedRecipe as any))?.ingredientsJson;
            const items = JSON.parse(json || '[]') as any[];
            const seen = new Set<string>();
            const groups: string[] = [];
            for (const item of items) {
                const g = item.groupName || 'Main Components';
                if (!seen.has(g)) { seen.add(g); groups.push(g); }
            }
            setModuleOrder(prev => groups.map(g => prev.find(p => p.groupName === g) ?? { id: crypto.randomUUID(), groupName: g }));
        } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedRecipe?.id, isEditing]);

    useEffect(() => {
        if (!deleteConfirmOpen) return;
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setDeleteConfirmOpen(false); };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [deleteConfirmOpen]);

    const loadData = async () => {
        setIsLoading(true);
        const [data, preps, cats] = await Promise.all([
            getDigitalRecipes(),
            getAvailablePrepRecipes(),
            getCategories('RECIPE')
        ]);
        setRecipes(data);
        setAvailablePreps(preps);
        setCategories(cats || []);
        setIsLoading(false);
    };

    const handleCreateNew = () => {
        const newData = {
            type: activeTab,
            name: '',
            yield: '',
            overview: '',
            ingredientsJson: JSON.stringify([{ ingredient: '', quantity: '', metric: '', notes: '' }]),
            procedureJson: JSON.stringify(['']),
            platingTracksJson: JSON.stringify({ tracks: [], rows: [] }),
            mediaJson: JSON.stringify({ finalPhotoUrl: '' }),
            chefNotes: '• Vida Útil:\n• ',
            imageUrl: '',
            linkedIngredientId: '',
            categoryId: '',
        };
        setSelectedRecipe(null);
        setEditData(newData);
        setIsEditing(true);
        setBatchMultiplier(1);
    };

    const handleEdit = (recipe: any) => {
        const linked = availablePreps.find(p => p.digitalRecipeId === recipe.id);
        setSelectedRecipe(recipe);
        setEditData({ ...recipe, linkedIngredientId: linked ? linked.id : '' });
        setIsEditing(true);
        setBatchMultiplier(1);
    };

    const handleView = (recipe: any) => {
        setSelectedRecipe(recipe);
        setEditData(null);
        setIsEditing(false);
        setBatchMultiplier(1);
    };

    const handleSave = async () => {
        if (!editData.name) {
            alert(locale === 'es' ? 'El nombre es obligatorio' : 'Name is mandatory');
            return;
        }
        if (editData.type === 'RECETA' && !editData.categoryId) {
            alert(locale === 'es' ? 'La Categoría es obligatoria' : 'Category is mandatory');
            return;
        }
        const codeToSave = (editData.recipeCode || '').trim();
        if (!codeToSave) {
            alert('El código es requerido');
            return;
        }
        if (editData.type === 'EMPLATADO' && !codeToSave.startsWith('E-')) {
            alert('Los códigos de emplatado deben empezar con E-');
            return;
        }
        if (editData.type !== 'EMPLATADO' && codeToSave.startsWith('E-')) {
            alert('Solo los emplatados deben empezar con E-');
            return;
        }
        const availRes = await isRecipeCodeAvailable(codeToSave, selectedRecipe?.id);
        if (!availRes.available) {
            alert(`El código '${codeToSave}' ya está en uso por otra receta`);
            return;
        }
        setIsLoading(true);
        let res;
        if (selectedRecipe && selectedRecipe.id) {
            res = await updateDigitalRecipe(selectedRecipe.id, editData);
        } else {
            res = await createDigitalRecipe(editData);
        }
        if (res.success) {
            await loadData();
            setSelectedRecipe(res.recipe);
            setIsEditing(false);
        } else {
            alert((res as any).error || 'Error saving recipe');
        }
        setIsLoading(false);
    };

    const handleViewHistory = async (id: string) => {
        const h = await getRecipeHistory(id);
        setHistoryLogs(h);
        setShowHistory(true);
    };

    const handleDelete = async () => {
        if (!selectedRecipe) return;
        setIsLoading(true);
        const res = await deleteDigitalRecipe(selectedRecipe.id);
        if (res.success) {
            setDeleteConfirmOpen(false);
            await loadData();
            setSelectedRecipe(null);
            setIsEditing(false);
        } else {
            alert(locale === 'es' ? 'Error al eliminar el documento' : 'Error deleting document');
        }
        setIsLoading(false);
    };

    const handleSuggestCode = async () => {
        if (!editData?.categoryId) {
            alert(locale === 'es' ? 'Selecciona una categoría primero' : 'Select a category first');
            return;
        }
        const res = await suggestNextRecipeCode(editData.type, editData.categoryId);
        if (res.success) setEditData((prev: any) => ({ ...prev, recipeCode: res.suggestedCode }));
    };

    const updateIngredient = (index: number, field: string, val: string) => {
        const arr = JSON.parse(editData.ingredientsJson || '[]');
        if (arr[index]) {
            arr[index][field] = val;
            setEditData({ ...editData, ingredientsJson: JSON.stringify(arr) });
        }
    };
    const addIngredientRow = () => {
        const arr = JSON.parse(editData.ingredientsJson || '[]');
        arr.push({ ingredient: '', quantity: '', metric: '', notes: '' });
        setEditData({ ...editData, ingredientsJson: JSON.stringify(arr) });
    };
    const removeIngredientRow = (index: number) => {
        const arr = JSON.parse(editData.ingredientsJson || '[]');
        arr.splice(index, 1);
        setEditData({ ...editData, ingredientsJson: JSON.stringify(arr) });
    };

    const updateLinkedIngredientNote = (ingredientName: string, val: string, currentList: any[]) => {
        const updatedList = currentList.map(item =>
            item.ingredient === ingredientName ? { ...item, notes: val } : item
        );
        setEditData({ ...editData, ingredientsJson: JSON.stringify(updatedList) });
    };

    const updateProcSteps = (next: Array<{ id: string; text: string }>) => {
        setProcSteps(next);
        setEditData((prev: any) => ({ ...prev, procedureJson: JSON.stringify(next.map(s => s.text)) }));
    };
    const updateProcedure = (index: number, val: string) => {
        updateProcSteps(procSteps.map((s, i) => i === index ? { ...s, text: val } : s));
    };
    const addProcedureRow = () => {
        updateProcSteps([...procSteps, { id: crypto.randomUUID(), text: '' }]);
    };
    const removeProcedureRow = (index: number) => {
        updateProcSteps(procSteps.filter((_, i) => i !== index));
    };


    const filteredList = recipes.filter(r => {
        if (r.type !== activeTab) return false;
        if (!searchQuery) return true;
        const searchUpper = searchQuery.toUpperCase();
        const n1 = (r.name || '').toUpperCase();
        const n2 = (r.nameEs || '').toUpperCase();
        return n1.includes(searchUpper) || n2.includes(searchUpper);
    });

    // ============================================
    // MAIN LIST RENDER
    // ============================================
    if (!selectedRecipe && !isEditing) {
        return (
            <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h1 style={{ fontSize: '2.5rem', marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <BookOpen size={36} color="var(--accent-primary)" />
                            {locale === 'es' ? 'Recetario Digital' : 'Digital Recipe Book'}
                        </h1>
                        <p style={{ color: 'var(--text-secondary)' }}>{locale === 'es' ? 'Documentación estándar y guías operativas.' : 'Standard operating procedures and recipes.'}</p>
                    </div>
                    {isAdmin && (
                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <button className="btn-secondary" onClick={() => setIsManageCategoriesOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 1.2rem', borderRadius: '8px' }}>
                                <BookOpen size={18} />
                                {locale === 'es' ? 'Gestionar Categorías' : 'Manage Categories'}
                            </button>
                        </div>
                    )}
                </div>

                <div className="glass-panel" style={{ padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2rem', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                    <div style={{ display: 'flex', gap: '1rem' }}>
                        {[
                            { id: 'RECETA', label: locale === 'es' ? 'Recetas' : 'Recipes' },
                            { id: 'EMPLATADO', label: locale === 'es' ? 'Emplatados' : 'Platings' },
                            { id: 'GUIA', label: locale === 'es' ? 'Guía de Tareas Básicas' : 'Basic Task Guides' }
                        ].map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                style={{
                                    padding: '0.6rem 1.2rem',
                                    borderRadius: '8px',
                                    fontWeight: 500,
                                    fontSize: '0.95rem',
                                    color: activeTab === tab.id ? 'white' : 'var(--text-secondary)',
                                    background: activeTab === tab.id ? 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))' : 'transparent',
                                    border: activeTab === tab.id ? 'none' : '1px solid rgba(255,255,255,0.1)',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s'
                                }}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>
                    <div style={{ position: 'relative', width: '300px' }}>
                        <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                        <input
                            type="text"
                            placeholder={locale === 'es' ? 'Buscar receta...' : 'Search recipe...'}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            style={{
                                width: '100%',
                                padding: '0.6rem 1rem 0.6rem 2.5rem',
                                borderRadius: '8px',
                                border: '1px solid var(--border)',
                                background: 'var(--bg-primary)',
                                color: 'var(--text-primary)',
                                outline: 'none'
                            }}
                        />
                    </div>
                </div>

                {isAdmin && (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '2rem' }}>
                        <button className="btn-primary" onClick={handleCreateNew} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.8rem 1.5rem', borderRadius: '8px', fontSize: '1.05rem', fontWeight: 600 }}>
                            <Plus size={20} />
                            {locale === 'es' 
                                ? (activeTab === 'RECETA' ? 'Nueva Receta' : activeTab === 'EMPLATADO' ? 'Nuevo Emplatado' : 'Nueva Guía')
                                : (activeTab === 'RECETA' ? 'New Recipe' : activeTab === 'EMPLATADO' ? 'New Plating' : 'New Guide')}
                        </button>
                    </div>
                )}

                {isLoading ? (
                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading...</div>
                ) : filteredList.length === 0 ? (
                    <div style={{ padding: '2rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
                        {locale === 'es' ? 'No hay documentos en esta sección.' : 'No documents in this section.'}
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3rem' }}>
                        {/* Group logic */}
                        {(() => {
                            const validCategories = Array.isArray(categories) ? categories : [];

                            const sortedCategories = [...validCategories].sort((a, b) => {
                                const nameA = (locale === 'es' && a.nameEs ? a.nameEs : a.name) || '';
                                const nameB = (locale === 'es' && b.nameEs ? b.nameEs : b.name) || '';
                                return nameA.localeCompare(nameB);
                            });

                            const grouped = sortedCategories.map(cat => {
                                const items = filteredList.filter(r => r.categoryId === cat.id);
                                items.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                                return { category: cat, items };
                            }).filter(g => g.items.length > 0);

                            // Any recipe that doesn't belong to an existing category goes here
                            const uncategorized = filteredList.filter(r => !r.categoryId || !validCategories.some(c => c.id === r.categoryId));
                            uncategorized.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                            if (uncategorized.length > 0) {
                                grouped.push({ category: { id: 'none', name: 'Uncategorized', nameEs: 'Sin Categoría' }, items: uncategorized });
                            }

                            return grouped.map(group => (
                                <div key={group.category?.id || 'none'} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                    <h2 style={{ fontSize: '1.4rem', color: 'var(--text-primary)', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem', margin: 0, fontWeight: 'bold', textTransform: 'uppercase' }}>
                                        {locale === 'es' && group.category?.nameEs ? group.category.nameEs : (group.category?.name || 'SIN CATEGORÍA')}
                                    </h2>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', paddingBottom: '1rem' }}>
                                        {group.items.map(recipe => (
                                            <div key={recipe.id} onClick={() => handleView(recipe)} className="glass-panel" style={{ padding: '1.5rem', cursor: 'pointer', transition: 'transform 0.2s', display: 'flex', flexDirection: 'column', gap: '0.5rem', width: '100%' }} onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-4px)'} onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                                    <span style={{ background: 'rgba(59, 130, 246, 0.2)', color: '#60a5fa', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 600 }}>
                                                        {recipe.recipeCode}
                                                    </span>
                                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                                        ↻ {new Date(recipe.revisionDate).toLocaleDateString()}
                                                    </span>
                                                </div>
                                                <h3 style={{ margin: '0.5rem 0', fontSize: '1.25rem', whiteSpace: 'normal' }}>{recipe.name}</h3>
                                                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', flex: 1, margin: 0, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', whiteSpace: 'normal' }}>
                                                    {recipe.overview || 'Sin descripción'}
                                                </p>
                                                {isAdmin && (
                                                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem', borderTop: '1px solid var(--border)', paddingTop: '0.5rem' }}>
                                                        <button onClick={(e) => { e.stopPropagation(); handleEdit(recipe); }} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem' }} onMouseOver={(e) => e.currentTarget.style.color = 'white'} onMouseOut={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}>
                                                            <Pencil size={14} /> Editar
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ));
                        })()}
                    </div>
                )}

                {isManageCategoriesOpen && (
                    <ManageOptionsModal
                        isOpen={isManageCategoriesOpen}
                        onClose={() => { setIsManageCategoriesOpen(false); loadData(); }}
                        categoryType="RECIPE"
                    />
                )}
            </div>
        );
    }

    // ============================================
    // EDITOR OR VIEWER RENDER
    // ============================================
    const docData = isEditing ? editData : selectedRecipe;

    const codeValidationError = (() => {
        if (!isEditing || !editData) return '';
        const code = (editData.recipeCode || '').trim();
        if (!code) return 'El código es requerido';
        if (editData.type === 'EMPLATADO' && !code.startsWith('E-')) return 'Los códigos de emplatado deben empezar con E-';
        if (editData.type !== 'EMPLATADO' && code.startsWith('E-')) return 'Solo los emplatados deben empezar con E-';
        return '';
    })();

    let ingrList: any[] = [];
    try { ingrList = JSON.parse(docData.ingredientsJson || '[]'); } catch { }

    let procList: string[] = [];
    try { procList = JSON.parse(docData.procedureJson || '[]'); } catch { }

    let platingData: any = { tracks: [], rows: [] };
    try { platingData = JSON.parse(docData.platingTracksJson || '{"tracks":[],"rows":[]}'); } catch { }
    let mediaData: any = { finalPhotoUrl: '' };
    try { mediaData = JSON.parse(docData.mediaJson || '{"finalPhotoUrl":""}'); } catch { }

    const updatePlatingState = (newData: any) => {
        setEditData({ ...editData, platingTracksJson: JSON.stringify(newData) });
    };

    const addPlatingTrack = () => {
        const newData = { ...platingData };
        newData.tracks.push({ id: Math.random().toString(36).substring(7), name: 'Nuevo Track' });
        updatePlatingState(newData);
    };
    const updatePlatingTrack = (id: string, name: string) => {
        const newData = { ...platingData };
        const track = newData.tracks.find((t: any) => t.id === id);
        if (track) track.name = name;
        updatePlatingState(newData);
    };
    const removePlatingTrack = (id: string) => {
        const newData = { ...platingData };
        newData.tracks = newData.tracks.filter((t: any) => t.id !== id);
        newData.rows.forEach((row: any) => { if (row.cells[id]) delete row.cells[id]; });
        updatePlatingState(newData);
    };
    const addPlatingRow = () => {
        const newData = { ...platingData };
        newData.rows.push({ id: Math.random().toString(36).substring(7), isSimultaneous: false, cells: {} });
        updatePlatingState(newData);
    };
    const addMergedPlatingRow = () => {
        const newData = { ...platingData };
        newData.rows.push({ id: Math.random().toString(36).substring(7), isSimultaneous: false, isMerged: true, cells: {} });
        updatePlatingState(newData);
    };
    const updatePlatingRow = (id: string, isSimultaneous: boolean) => {
        const newData = { ...platingData };
        const row = newData.rows.find((r: any) => r.id === id);
        if (row) row.isSimultaneous = isSimultaneous;
        updatePlatingState(newData);
    };
    const updatePlatingCell = (rowId: string, trackId: string, text: string, imageUrl?: string) => {
        const newData = { ...platingData };
        const row = newData.rows.find((r: any) => r.id === rowId);
        if (row) {
            if (!row.cells[trackId]) row.cells[trackId] = { text: '', imageUrl: '' };
            if (text !== undefined) row.cells[trackId].text = text;
            if (imageUrl !== undefined) row.cells[trackId].imageUrl = imageUrl;
        }
        updatePlatingState(newData);
    };
    const removePlatingRow = (id: string) => {
        const newData = { ...platingData };
        newData.rows = newData.rows.filter((r: any) => r.id !== id);
        updatePlatingState(newData);
    };

    const activeLinkedId = docData?.linkedIngredientId || availablePreps.find(p => p.digitalRecipeId === docData?.id)?.id;

    const renderBoldText = (text: string) => {
        if (!text) return null;
        const parts = text.split(/(\*\*.*?\*\*)/g);
        return parts.map((part, i) => {
            if (part.startsWith('**') && part.endsWith('**')) {
                return <strong key={i} style={{ fontWeight: 'bold', color: 'var(--text-primary)' }}>{part.slice(2, -2)}</strong>;
            }
            return <span key={i}>{part}</span>;
        });
    };

    if (activeLinkedId) {
        const match = availablePreps.find(p => p.id === activeLinkedId);
        if (match && match.composedOf) {
            ingrList = match.composedOf.map((comp: any) => {
                const liveName = (locale === 'es' && comp.ingredient?.nameEs) ? comp.ingredient.nameEs : (comp.ingredient?.name || '');
                const savedItem = ingrList.find((i: any) => i.ingredient === liveName);
                return {
                    ingredient: liveName,
                    quantity: comp.quantity?.toString() || '',
                    metric: comp.unit || '',
                    notes: savedItem?.notes || '',
                    groupName: comp.groupName || 'Main Components'
                };
            });
        }
    }

    return (
        <div style={{ padding: '2rem', maxWidth: '1000px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button onClick={() => { setIsEditing(false); setSelectedRecipe(null); setEditData(null); }} className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem' }}>
                    <ArrowLeft size={16} /> {locale === 'es' ? 'Volver al Recetario' : 'Back to List'}
                </button>
                <div style={{ display: 'flex', gap: '1rem' }}>
                    {selectedRecipe && !isEditing && (
                        <button onClick={() => handleViewHistory(selectedRecipe.id)} className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <History size={16} /> {locale === 'es' ? 'Ver Historial' : 'View History'}
                        </button>
                    )}
                    {!isEditing && isAdmin && selectedRecipe && (
                        <button onClick={() => setDeleteConfirmOpen(true)} className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--danger)', border: '1px solid var(--danger)' }}>
                            <Trash2 size={16} /> {locale === 'es' ? 'Eliminar' : 'Delete'}
                        </button>
                    )}
                    {!isEditing && isAdmin && (
                        <button onClick={() => handleEdit(selectedRecipe)} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--accent-primary)' }}>
                            <Pencil size={16} /> {locale === 'es' ? 'Editar Documento' : 'Edit Document'}
                        </button>
                    )}
                    {isEditing && (
                        <button onClick={handleSave} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--success)', border: 'none' }}>
                            <Save size={16} /> {locale === 'es' ? 'Guardar Cambios' : 'Save Changes'}
                        </button>
                    )}
                </div>
            </div>

            <div className="glass-panel" style={{ padding: '3rem', background: isEditing ? 'var(--bg-secondary)' : 'var(--bg-primary)', border: isEditing ? '1px dashed var(--border)' : '1px solid var(--border)', color: 'var(--text-primary)' }}>
                {/* Header Section */}
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid var(--border)', paddingBottom: '1.5rem', marginBottom: '2rem' }}>
                    <div style={{ flex: 1 }}>
                        {!isEditing && (
                            <div style={{ color: '#60a5fa', fontWeight: 'bold', fontSize: '1.1rem', marginBottom: '0.5rem' }}>
                                {docData.recipeCode || 'NEW'}
                            </div>
                        )}
                        {isEditing ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                <div>
                                    <label style={{ fontSize: '0.9rem', color: 'var(--accent-primary)', marginBottom: '0.25rem', display: 'block' }}>Código</label>
                                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                        <input
                                            value={editData.recipeCode || ''}
                                            onChange={e => setEditData({ ...editData, recipeCode: e.target.value.toUpperCase() })}
                                            placeholder={editData.type === 'EMPLATADO' ? 'E-APP-001' : 'APP-001'}
                                            style={{ width: '130px', fontFamily: 'monospace', fontWeight: 700, background: 'transparent', border: `1px solid ${codeValidationError ? 'var(--danger)' : 'var(--border)'}`, borderRadius: '4px', padding: '0.4rem 0.6rem', color: '#60a5fa', fontSize: '1rem' }}
                                        />
                                        <button type="button" onClick={handleSuggestCode} className="btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                                            Sugerir código
                                        </button>
                                    </div>
                                    {codeValidationError && (
                                        <span style={{ color: 'var(--danger)', fontSize: '0.8rem', marginTop: '0.25rem', display: 'block' }}>{codeValidationError}</span>
                                    )}
                                </div>
                                <input
                                    value={docData.name}
                                    onChange={e => setEditData({ ...docData, name: e.target.value })}
                                    placeholder={locale === 'es' ? (docData.type === 'RECETA' ? 'Título de la Receta' : docData.type === 'EMPLATADO' ? 'Título del Emplatado' : 'Título de la Guía') : (docData.type === 'RECETA' ? 'Recipe Title' : docData.type === 'EMPLATADO' ? 'Plating Title' : 'Guide Title')}
                                    style={{ fontSize: '2.5rem', fontWeight: 800, background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', width: '100%', color: 'var(--text-primary)', padding: '0.5rem 0' }}
                                />
                                {docData.type === 'RECETA' && (
                                    <div>
                                        <label style={{ fontSize: '0.9rem', color: 'var(--accent-primary)', marginBottom: '0.25rem', display: 'block' }}>Enlace a Receta del Inventario (Opcional)</label>
                                        <SearchableSelect
                                            name="linkedIngredientId"
                                            value={docData.linkedIngredientId || ''}
                                            onChange={(val) => {
                                                const newEditData = { ...docData, linkedIngredientId: val };
                                                if (val) {
                                                    const match = availablePreps.find(p => p.id === val);
                                                    if (match) {
                                                        if (!docData.name) newEditData.name = match.name;

                                                        const yieldStr = `${match.portionWeightG || 1} ${match.metric === 'L' ? 'Litros' : match.metric === 'Kg' ? 'Kilos' : match.metric || ''}`.trim();
                                                        newEditData.yield = yieldStr;

                                                        if (match.composedOf && match.composedOf.length > 0) {
                                                            const newIngr = match.composedOf.map((comp: any) => ({
                                                                ingredient: (locale === 'es' && comp.ingredient?.nameEs) ? comp.ingredient.nameEs : (comp.ingredient?.name || ''),
                                                                quantity: comp.quantity?.toString() || '',
                                                                metric: comp.unit || '',
                                                                notes: '',
                                                                groupName: comp.groupName || 'Main Components'
                                                            }));
                                                            newEditData.ingredientsJson = JSON.stringify(newIngr);
                                                        }
                                                    }
                                                }
                                                setEditData(newEditData);
                                            }}
                                            options={[{ value: '', label: 'Ninguno' }, ...availablePreps.filter(p => !p.digitalRecipeId || p.digitalRecipeId === selectedRecipe?.id).map(p => ({ value: p.id, label: p.name }))]}
                                            placeholder="Vincular con Receta de Inventario..."
                                        />
                                    </div>
                                )}
                                <div>
                                    <label style={{ fontSize: '0.9rem', color: 'var(--accent-primary)', marginBottom: '0.25rem', display: 'block' }}>{locale === 'es' ? 'Categoría' : 'Category'}</label>
                                    <SearchableSelect
                                        name="categoryId"
                                        value={docData.categoryId || ''}
                                        onChange={async (val) => {
                                            const newEditData = { ...editData, categoryId: val };
                                            if (val) {
                                                const res = await suggestNextRecipeCode(editData.type, val);
                                                if (res.success) newEditData.recipeCode = res.suggestedCode;
                                            }
                                            setEditData(newEditData);
                                        }}
                                        options={[{ value: '', label: 'Sin Categoría' }, ...categories.map(c => ({ value: c.id, label: (locale === 'es' && c.nameEs) ? c.nameEs : c.name }))]}
                                        placeholder="Seleccionar Categoría..."
                                    />
                                </div>
                            </div>
                        ) : (
                            <div>
                                <h1 style={{ fontSize: '2.5rem', margin: 0 }}>{docData.name}</h1>
                                {docData.id && availablePreps.find(p => p.digitalRecipeId === docData.id) && (
                                    <span style={{ fontSize: '0.9rem', color: 'var(--accent-primary)', background: 'rgba(59, 130, 246, 0.1)', padding: '0.2rem 0.5rem', borderRadius: '4px', marginTop: '0.5rem', display: 'inline-block' }}>
                                        Vinculado a: {availablePreps.find(p => p.digitalRecipeId === docData.id)?.name}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                    <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: '1rem', justifyContent: 'flex-start', marginLeft: '2rem' }}>
                        <div style={{ display: 'flex', gap: '2rem', justifyContent: 'flex-end', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
                            {!isEditing && docData.type === 'RECETA' && (
                                <div style={{ textAlign: 'right' }}>
                                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>
                                        {locale === 'es' ? 'Multiplicador (Batches)' : 'Multiplier (Batches)'}
                                    </span>
                                    <input
                                        type="number"
                                        min="1"
                                        value={batchMultiplier}
                                        onFocus={(e) => e.target.select()}
                                        onChange={(e) => {
                                            if (e.target.value === '') setBatchMultiplier('');
                                            else setBatchMultiplier(Math.max(1, parseInt(e.target.value) || 1));
                                        }}
                                        onBlur={() => {
                                            if (batchMultiplier === '' || (typeof batchMultiplier === 'number' && batchMultiplier < 1)) setBatchMultiplier(1);
                                        }}
                                        style={{ width: '80px', textAlign: 'right', background: 'var(--bg-secondary)', border: '1px solid var(--border)', padding: '0.4rem', borderRadius: '4px', color: 'var(--accent-primary)', fontWeight: 'bold' }}
                                    />
                                </div>
                            )}
                            {docData.type === 'RECETA' && (
                                <div>
                                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>{locale === 'es' ? 'Rendimiento' : 'Yield'}</span>
                                    {isEditing ? (
                                        <input
                                            value={docData.yield || ''}
                                            onChange={e => setEditData({ ...docData, yield: e.target.value })}
                                            placeholder="e.g. Approx. 5 Litros"
                                            style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', padding: '0.4rem', borderRadius: '4px', color: 'var(--text-primary)', textAlign: 'right' }}
                                        />
                                    ) : (
                                        <span style={{ fontWeight: 600, fontSize: '14pt', color: activeMultiplier > 1 ? 'var(--accent-secondary)' : 'inherit' }}>
                                            {docData.yield ? (
                                                (() => {
                                                    const match = docData.yield.match(/^([\d.]+)\s*(.*)$/);
                                                    if (match && activeMultiplier > 1) {
                                                        return `${Math.round(parseFloat(match[1]) * activeMultiplier)} ${match[2]}`;
                                                    }
                                                    return docData.yield;
                                                })()
                                            ) : '-'}</span>
                                    )}
                                </div>
                            )}
                        </div>
                        <div>
                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', display: 'block' }}>{locale === 'es' ? 'Fecha de Revisión' : 'Revision Date'}</span>
                            <span style={{ fontWeight: 600 }}>{docData.revisionDate ? new Date(docData.revisionDate).toLocaleDateString() : 'Pending'}</span>
                        </div>
                    </div>
                </div>



                {/* Final Plated Photo for Emplatados */}
                {docData.type === 'EMPLATADO' && (
                    <div style={{ marginBottom: '2.5rem' }}>
                        <h3 style={{ fontSize: '1.1rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '1px' }}>{locale === 'es' ? 'Foto Plato Final' : 'Final Plated Photo'}</h3>
                        {isEditing ? (
                            <ImageUpload 
                                currentUrl={mediaData.finalPhotoUrl}
                                onUploadComplete={(url) => setEditData({...docData, mediaJson: JSON.stringify({ ...mediaData, finalPhotoUrl: url })})}
                                onRemove={() => setEditData({...docData, mediaJson: JSON.stringify({ ...mediaData, finalPhotoUrl: '' })})}
                                placeholder={locale === 'es' ? 'Subir Foto Principal del Plato' : 'Upload Main Plated Photo'}
                            />
                        ) : (
                            mediaData.finalPhotoUrl ? (
                                <div style={{ maxWidth: '400px', cursor: 'pointer' }} onClick={() => window.open(mediaData.finalPhotoUrl, '_blank')}>
                                    <img src={mediaData.finalPhotoUrl} alt="Plato Final" style={{ width: '100%', borderRadius: '8px', border: '2px solid var(--border)' }} />
                                </div>
                            ) : (
                                <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>Sin imagen final.</span>
                            )
                        )}
                    </div>
                )}

                {/* Overview */}
                {docData.type !== 'EMPLATADO' && (
                    <div style={{ marginBottom: '2.5rem' }}>
                        <h3 style={{ fontSize: '1.1rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '1px' }}>{locale === 'es' ? 'Visión General' : 'Overview'}</h3>
                        {isEditing ? (
                            <textarea
                                value={docData.overview || ''}
                                onChange={e => setEditData({ ...docData, overview: e.target.value })}
                                rows={3}
                                style={{ width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border)', padding: '1rem', borderRadius: '8px', color: 'var(--text-primary)', resize: 'vertical' }}
                            />
                        ) : (
                            <p style={{ lineHeight: 1.6, margin: 0 }}>{docData.overview}</p>
                        )}
                    </div>
                )}

                {/* Ingredients Table */}
                {docData.type !== 'EMPLATADO' && (
                    <div style={{ marginBottom: '2.5rem' }}>
                        <h3 style={{ fontSize: '1.2rem', color: 'var(--text-primary)', marginBottom: '1.5rem', textTransform: 'uppercase', letterSpacing: '1px' }}>{locale === 'es' ? 'Ingredientes' : 'Ingredients'}</h3>

                    {(() => {
                        const groupedIngrs = ingrList.reduce((acc, ingr, idx) => {
                            const group = ingr.groupName || 'Main Components';
                            if (!acc[group]) acc[group] = [];
                            acc[group].push({ ...ingr, originalIndex: idx });
                            return acc;
                        }, {} as Record<string, any[]>);

                        const keys = Object.keys(groupedIngrs);
                        if (keys.length === 0) {
                            return (
                                <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)', fontStyle: 'italic', border: '1px dashed var(--border)', borderRadius: '8px' }}>
                                    {locale === 'es' ? 'No hay ingredientes definidos.' : 'No ingredients defined.'}
                                </div>
                            );
                        }

                        if (isEditing) {
                            return (
                                <DndContext
                                    sensors={sensors}
                                    collisionDetection={closestCenter}
                                    onDragEnd={({ active, over }) => {
                                        if (!over || active.id === over.id) return;
                                        const oldIdx = moduleOrder.findIndex(m => m.id === (active.id as string));
                                        const newIdx = moduleOrder.findIndex(m => m.id === (over.id as string));
                                        if (oldIdx === -1 || newIdx === -1) return;
                                        const newOrder = arrayMove(moduleOrder, oldIdx, newIdx);
                                        setModuleOrder(newOrder);
                                        const items = JSON.parse(editData.ingredientsJson || '[]') as any[];
                                        const grouped: Record<string, any[]> = {};
                                        for (const item of items) {
                                            const g = item.groupName || 'Main Components';
                                            if (!grouped[g]) grouped[g] = [];
                                            grouped[g].push(item);
                                        }
                                        const rebuilt = newOrder.flatMap(m => grouped[m.groupName] ?? []);
                                        setEditData((prev: any) => ({ ...prev, ingredientsJson: JSON.stringify(rebuilt) }));
                                    }}
                                >
                                    <SortableContext items={moduleOrder.map(m => m.id)} strategy={verticalListSortingStrategy}>
                                        {moduleOrder.map(({ id, groupName }) => (
                                            <SortableIngredientModule
                                                key={id}
                                                id={id}
                                                groupName={groupName}
                                                items={groupedIngrs[groupName] ?? []}
                                                showHeader={moduleOrder.length > 1 || groupName !== 'Main Components'}
                                                activeLinkedId={activeLinkedId}
                                                activeMultiplier={activeMultiplier}
                                                locale={locale}
                                                getOptName={getOptName}
                                                updateIngredient={updateIngredient}
                                                updateLinkedIngredientNote={updateLinkedIngredientNote}
                                                removeIngredientRow={removeIngredientRow}
                                                ingrList={ingrList}
                                            />
                                        ))}
                                    </SortableContext>
                                </DndContext>
                            );
                        }

                        return keys.map((groupName) => (
                            <div key={groupName} style={{ marginBottom: '2rem' }}>
                                {(keys.length > 1 || groupName !== 'Main Components') && (
                                    <h4 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--accent-primary)', marginBottom: '0.8rem', paddingBottom: '0.3rem', borderBottom: '1px solid var(--border)' }}>
                                        {groupName}
                                    </h4>
                                )}
                                <div className="glass-panel" style={{ padding: '0.5rem', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                                        <thead>
                                            <tr style={{ borderBottom: '1px solid var(--border)' }}>
                                                <th style={{ padding: '0.5rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{locale === 'es' ? 'Ingrediente' : 'Ingredient'}</th>
                                                <th style={{ padding: '0.5rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{locale === 'es' ? 'Cantidad' : 'Quantity'}</th>
                                                <th style={{ padding: '0.5rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{locale === 'es' ? 'U. de Medida' : 'Metric'}</th>
                                                <th style={{ padding: '0.5rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{locale === 'es' ? 'Notas' : 'Notes'}</th>
                                                {isEditing && <th style={{ padding: '0.5rem', width: '40px' }}></th>}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {groupedIngrs[groupName].map((ingr: any, localIdx: number) => {
                                                const idx = ingr.originalIndex;
                                                return (
                                                    <tr key={idx} style={{ borderBottom: '1px solid var(--border)', background: localIdx % 2 === 0 ? 'rgba(0,0,0,0.15)' : 'transparent' }}>
                                                        {isEditing ? (
                                                            activeLinkedId ? (
                                                                <>
                                                                    <td style={{ padding: '0.8rem 0.5rem', fontWeight: 500 }}>{ingr.ingredient}</td>
                                                                    <td style={{ padding: '0.8rem 0.5rem' }}>{ingr.quantity}</td>
                                                                    <td style={{ padding: '0.8rem 0.5rem' }}>{getOptName(ingr.metric)}</td>
                                                                    <td style={{ padding: '0.4rem' }}><textarea value={ingr.notes} onChange={e => updateLinkedIngredientNote(ingr.ingredient, e.target.value, ingrList)} rows={2} style={{ width: '100%', padding: '0.4rem', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-primary)', resize: 'vertical' }} /></td>
                                                                    <td style={{ padding: '0.4rem', textAlign: 'center' }}></td>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <td style={{ padding: '0.4rem' }}><textarea value={ingr.ingredient} onChange={e => updateIngredient(idx, 'ingredient', e.target.value)} rows={2} style={{ width: '100%', padding: '0.4rem', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-primary)', resize: 'vertical' }} /></td>
                                                                    <td style={{ padding: '0.4rem' }}><input value={ingr.quantity} onChange={e => updateIngredient(idx, 'quantity', e.target.value)} style={{ width: '100%', padding: '0.4rem', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-primary)' }} /></td>
                                                                    <td style={{ padding: '0.4rem' }}><input value={ingr.metric} onChange={e => updateIngredient(idx, 'metric', e.target.value)} style={{ width: '100%', padding: '0.4rem', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-primary)' }} /></td>
                                                                    <td style={{ padding: '0.4rem' }}><textarea value={ingr.notes} onChange={e => updateIngredient(idx, 'notes', e.target.value)} rows={2} style={{ width: '100%', padding: '0.4rem', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-primary)', resize: 'vertical' }} /></td>
                                                                    <td style={{ padding: '0.4rem', textAlign: 'center' }}><button onClick={() => removeIngredientRow(idx)} style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer' }}><X size={16} /></button></td>
                                                                </>
                                                            )
                                                        ) : (
                                                            <>
                                                                <td style={{ padding: '0.8rem 0.5rem', fontWeight: 500 }}>{ingr.ingredient}</td>
                                                                <td style={{ padding: '0.8rem 0.5rem', fontWeight: activeMultiplier > 1 ? 'bold' : 'normal', color: activeMultiplier > 1 ? 'var(--accent-secondary)' : 'inherit' }}>
                                                                    {(() => {
                                                                        const qty = parseFloat(ingr.quantity);
                                                                        return !isNaN(qty) ? Math.round(qty * activeMultiplier) : ingr.quantity;
                                                                    })()}
                                                                </td>
                                                                <td style={{ padding: '0.8rem 0.5rem' }}>{getOptName(ingr.metric)}</td>
                                                                <td style={{ padding: '0.8rem 0.5rem', color: 'var(--text-secondary)', fontSize: '0.9rem', whiteSpace: 'pre-wrap' }}>{ingr.notes}</td>
                                                            </>
                                                        )}
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        ));
                    })()}

                    {isEditing && !activeLinkedId && (
                        <button onClick={addIngredientRow} style={{ marginTop: '0.5rem', background: 'transparent', border: '1px dashed var(--border)', padding: '0.5rem', width: '100%', color: 'var(--text-secondary)', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }} onMouseOver={(e) => e.currentTarget.style.color = 'white'} onMouseOut={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}>
                            <Plus size={16} /> Agregar Ingrediente
                        </button>
                    )}
                    </div>
                )}

                {/* Procedure List or Plating Tracks */}
                {docData.type === 'EMPLATADO' ? (
                    <div style={{ marginBottom: '2.5rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                            <h3 style={{ fontSize: '1.2rem', color: 'var(--text-primary)', margin: 0, textTransform: 'uppercase', letterSpacing: '1px' }}>
                                {locale === 'es' ? 'Flujo de Emplatado Simultáneo' : 'Simultaneous Plating Workflow'}
                            </h3>
                            {isEditing && (
                                <button type="button" onClick={addPlatingTrack} className="btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                    <Plus size={14} /> {locale === 'es' ? 'Agregar Pista (Track)' : 'Add Track'}
                                </button>
                            )}
                        </div>

                        {platingData.tracks.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-secondary)', border: '1px dashed var(--border)', borderRadius: '8px' }}>
                                {locale === 'es' ? 'Agrega una pista (e.g. Proteína) para comenzar.' : 'Add a track to start.'}
                            </div>
                        ) : (
                            <div style={{ overflowX: 'auto', background: 'transparent' }}>
                                {(() => {
                                    const rowGroups: any[] = [];
                                    let currentGroup: any = null;
                                    platingData.rows.forEach((row: any, rIdx: number) => {
                                        if (row.isMerged) {
                                            if (!currentGroup || currentGroup.type !== 'merged') {
                                                if (currentGroup) rowGroups.push(currentGroup);
                                                currentGroup = { type: 'merged', rows: [] };
                                            }
                                            currentGroup.rows.push({ ...row, originalIndex: rIdx });
                                        } else {
                                            if (!currentGroup || currentGroup.type !== 'simultaneous') {
                                                if (currentGroup) rowGroups.push(currentGroup);
                                                currentGroup = { type: 'simultaneous', rows: [] };
                                            }
                                            currentGroup.rows.push({ ...row, originalIndex: rIdx });
                                        }
                                    });
                                    if (currentGroup) rowGroups.push(currentGroup);

                                    return (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                            {/* Header Row */}
                                            <div style={{ padding: '0 1.5rem' }}>
                                                <div style={{ display: 'grid', gridTemplateColumns: `repeat(${platingData.tracks.length}, minmax(280px, 1fr)) ${isEditing ? '40px' : ''}`, gap: '1rem', alignItems: 'start' }}>
                                                    {platingData.tracks.map((track: any) => (
                                                        <div key={track.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.8rem', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: '6px' }}>
                                                            {isEditing ? (
                                                                <input value={track.name} onChange={e => updatePlatingTrack(track.id, e.target.value)} style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', fontWeight: 'bold', outline: 'none', width: '100%' }} placeholder="Nombre de Pista" />
                                                            ) : (
                                                                <span style={{ fontWeight: 'bold', color: 'var(--accent-primary)', fontSize: '1.1rem' }}>{track.name}</span>
                                                            )}
                                                            {isEditing && (
                                                                <button type="button" onClick={() => removePlatingTrack(track.id)} style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer' }}><X size={16}/></button>
                                                            )}
                                                        </div>
                                                    ))}
                                                    {isEditing && <div></div>}
                                                </div>
                                            </div>

                                            {/* Map over grouped rows */}
                                            {rowGroups.map((group, gIdx) => {
                                                if (group.type === 'merged') {
                                                    return (
                                                        <div key={gIdx} style={{ padding: '0 1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
                                                            <h4 style={{ margin: 0, fontSize: '1.05rem', color: '#d97706', textTransform: 'uppercase', letterSpacing: '1px', borderBottom: '1px solid rgba(251, 191, 36, 0.2)', paddingBottom: '0.8rem' }}>
                                                                {locale === 'es' ? 'Pasos Finales / Unificación' : 'Final Steps / Unification'}
                                                            </h4>
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                                                {group.rows.map((row: any) => {
                                                                    const rIdx = row.originalIndex;
                                                                    return (
                                                                        <div key={row.id} style={{ display: 'grid', gridTemplateColumns: `repeat(${platingData.tracks.length}, minmax(280px, 1fr)) ${isEditing ? '40px' : ''}`, gap: '1rem', alignItems: 'start' }}>
                                                                            <div style={{ 
                                                                                gridColumn: `span ${platingData.tracks.length}`,
                                                                                padding: '1rem 1.5rem',
                                                                                background: isEditing ? 'rgba(0,0,0,0.05)' : 'var(--bg-secondary)',
                                                                                border: isEditing ? '1px dashed var(--border)' : '1px solid var(--border)',
                                                                                borderRadius: '8px',
                                                                                display: 'flex', flexDirection: 'column', gap: '1rem',
                                                                                boxShadow: !isEditing ? '0 0 10px rgba(0,0,0,0.02)' : 'none',
                                                                                alignItems: 'flex-start'
                                                                            }}>
                                                                                {isEditing ? (
                                                                                    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                                                                        <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', width: '100%' }}>
                                                                                            <div style={{ background: '#fbbf24', color: '#000', width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem', fontWeight: 'bold', flexShrink: 0, marginTop: '4px' }}>
                                                                                                {rIdx + 1}
                                                                                            </div>
                                                                                            <textarea placeholder="Descripción del paso final unificado..." value={row.cells['merged']?.text || ''} onChange={e => updatePlatingCell(row.id, 'merged', e.target.value, row.cells['merged']?.imageUrl)} rows={3} style={{ width: '100%', background: 'var(--bg-primary)', border: '1px solid var(--border)', padding: '0.6rem', color: 'var(--text-primary)', resize: 'vertical', borderRadius: '4px', fontSize: '1rem', textAlign: 'left' }} />
                                                                                        </div>
                                                                                        <div style={{ paddingLeft: '3.5rem' }}>
                                                                                            <ImageUpload 
                                                                                                currentUrl={row.cells['merged']?.imageUrl}
                                                                                                onUploadComplete={(url) => updatePlatingCell(row.id, 'merged', row.cells['merged']?.text || '', url)}
                                                                                                onRemove={() => updatePlatingCell(row.id, 'merged', row.cells['merged']?.text || '', '')}
                                                                                                placeholder={locale === 'es' ? 'Foto Ref (Opcional)' : 'Ref Photo (Optional)'}
                                                                                            />
                                                                                        </div>
                                                                                    </div>
                                                                                ) : (
                                                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'flex-start', textAlign: 'left', width: '100%' }}>
                                                                                        <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                                                                                            <div style={{ background: '#fbbf24', color: '#000', width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem', fontWeight: 'bold', flexShrink: 0, marginTop: '2px' }}>
                                                                                                {rIdx + 1}
                                                                                            </div>
                                                                                            <span style={{ fontSize: '1.05rem', lineHeight: 1.6, whiteSpace: 'pre-wrap', flex: 1 }}>{renderBoldText(row.cells['merged']?.text || '')}</span>
                                                                                        </div>
                                                                                        {row.cells['merged']?.imageUrl && (
                                                                                            <div style={{ paddingLeft: '3.5rem', width: '100%' }}>
                                                                                                <img src={row.cells['merged']?.imageUrl} alt="Referencia" style={{ maxWidth: '600px', width: '100%', borderRadius: '6px', border: '1px solid var(--border)', maxHeight: '350px', objectFit: 'cover' }} />
                                                                                            </div>
                                                                                        )}
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                            {isEditing && (
                                                                                <button type="button" onClick={() => removePlatingRow(row.id)} style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: '0.5rem' }}><Trash2 size={18}/></button>
                                                                            )}
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    );
                                                } else {
                                                    // Simultaneous Track Wrapper
                                                    return (
                                                        <div key={gIdx} style={{ position: 'relative', padding: '1.5rem 1.5rem 0 1.5rem', marginBottom: '1rem' }}>
                                                            {/* Background Columns */}
                                                            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${platingData.tracks.length}, minmax(280px, 1fr)) ${isEditing ? '40px' : ''}`, gap: '1rem', position: 'absolute', top: 0, left: '1.5rem', right: '1.5rem', bottom: 0, pointerEvents: 'none' }}>
                                                                {platingData.tracks.map((track: any, tIdx: number) => (
                                                                    <div key={track.id} style={{ 
                                                                        background: tIdx % 2 === 0 ? 'rgba(59, 130, 246, 0.05)' : 'var(--bg-secondary)', 
                                                                        borderRadius: '12px', 
                                                                        border: tIdx % 2 === 0 ? '1px solid rgba(59, 130, 246, 0.1)' : '1px solid var(--border)' 
                                                                    }} />
                                                                ))}
                                                                {isEditing && <div></div>}
                                                            </div>

                                                            <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: '1rem', paddingBottom: '1.5rem' }}>
                                                                {group.rows.map((row: any) => {
                                                                    const rIdx = row.originalIndex;
                                                                    return (
                                                                        <div key={row.id} style={{ display: 'grid', gridTemplateColumns: `repeat(${platingData.tracks.length}, minmax(280px, 1fr)) ${isEditing ? '40px' : ''}`, gap: '1rem', alignItems: 'start' }}>
                                                                            {platingData.tracks.map((track: any, tIdx: number) => {
                                                                                const cellData = row.cells[track.id] || { text: '', imageUrl: '' };
                                                                                const isActive = !!(cellData.text || cellData.imageUrl);
                                                                                return (
                                                                                    <div key={track.id} style={{ 
                                                                                        padding: '1rem',
                                                                                        background: isEditing ? 'rgba(0,0,0,0.15)' : (isActive ? 'var(--bg-primary)' : 'transparent'),
                                                                                        border: isEditing ? '1px dashed var(--border)' : (isActive ? '1px solid var(--border)' : '1px dashed rgba(255,255,255,0.05)'),
                                                                                        borderRadius: '8px',
                                                                                        display: 'flex', flexDirection: 'column',
                                                                                        boxShadow: (!isEditing && row.isSimultaneous && isActive) ? '0 0 10px rgba(0, 0, 0, 0.05)' : 'none',
                                                                                        height: '100%'
                                                                                    }}>
                                                                                        {/* Step Badge inside block */}
                                                                                        {isActive || isEditing ? (
                                                                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                                                    <div style={{ background: row.isSimultaneous ? 'var(--accent-primary)' : 'var(--border)', color: 'white', width: '24px', height: '24px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 'bold' }}>
                                                                                                        {rIdx + 1}
                                                                                                    </div>
                                                                                                    {!isEditing && row.isSimultaneous && (
                                                                                                        <span style={{ fontSize: '0.7rem', color: 'var(--accent-primary)', fontWeight: 'bold', letterSpacing: '1px' }}>SIMULT.</span>
                                                                                                    )}
                                                                                                </div>
                                                                                                
                                                                                                {isEditing && tIdx === 0 && (
                                                                                                    <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer', background: row.isSimultaneous?'rgba(59,130,246,0.1)':'transparent', padding: '0.2rem 0.4rem', borderRadius: '4px' }}>
                                                                                                        <input type="checkbox" checked={row.isSimultaneous} onChange={e => updatePlatingRow(row.id, e.target.checked)} />
                                                                                                        Simult.
                                                                                                    </label>
                                                                                                )}
                                                                                            </div>
                                                                                        ) : null}

                                                                                        {isEditing ? (
                                                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                                                                                <textarea placeholder="Descripción del paso..." value={cellData.text} onChange={e => updatePlatingCell(row.id, track.id, e.target.value, cellData.imageUrl)} rows={3} style={{ width: '100%', background: 'var(--bg-primary)', border: '1px solid var(--border)', padding: '0.6rem', color: 'var(--text-primary)', resize: 'vertical', borderRadius: '4px', fontSize: '0.9rem' }} />
                                                                                                <ImageUpload 
                                                                                                    currentUrl={cellData.imageUrl}
                                                                                                    onUploadComplete={(url) => updatePlatingCell(row.id, track.id, cellData.text, url)}
                                                                                                    onRemove={() => updatePlatingCell(row.id, track.id, cellData.text, '')}
                                                                                                    placeholder={locale === 'es' ? 'Foto Ref (Opcional)' : 'Ref Photo (Optional)'}
                                                                                                />
                                                                                            </div>
                                                                                        ) : (
                                                                                            <>
                                                                                                {isActive ? (
                                                                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                                                                                        <span style={{ fontSize: '0.95rem', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{renderBoldText(cellData.text)}</span>
                                                                                                        {cellData.imageUrl && (
                                                                                                            <img src={cellData.imageUrl} alt="Referencia" style={{ width: '100%', borderRadius: '4px', border: '1px solid var(--border)', maxHeight: '200px', objectFit: 'cover' }} />
                                                                                                        )}
                                                                                                    </div>
                                                                                                ) : (
                                                                                                    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                                                                        <span style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.2)' }}>-</span>
                                                                                                    </div>
                                                                                                )}
                                                                                            </>
                                                                                        )}
                                                                                    </div>
                                                                                )
                                                                            })}
                                                                            {/* Delete Row Button */}
                                                                            {isEditing && (
                                                                                <div style={{ paddingTop: '0.8rem', textAlign: 'center' }}>
                                                                                    <button type="button" onClick={() => removePlatingRow(row.id)} style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: '0.5rem' }}><Trash2 size={18}/></button>
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    );
                                                }
                                            })}
                                        </div>
                                    );
                                })()}

                                {isEditing && (
                                    <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
                                        <button type="button" onClick={addPlatingRow} style={{ flex: 1, background: 'transparent', border: '2px dashed var(--accent-primary)', padding: '0.8rem', color: 'var(--text-primary)', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', fontWeight: 600 }} onMouseOver={(e) => e.currentTarget.style.background = 'rgba(59, 130, 246, 0.1)'} onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}>
                                            <Plus size={18} /> Agregar Pasos (Time Block)
                                        </button>
                                        <button type="button" onClick={addMergedPlatingRow} style={{ flex: 1, background: 'transparent', border: '2px dashed #fbbf24', padding: '0.8rem', color: 'var(--text-primary)', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', fontWeight: 600 }} onMouseOver={(e) => e.currentTarget.style.background = 'rgba(251, 191, 36, 0.1)'} onMouseOut={(e) => e.currentTarget.style.background = 'transparent'}>
                                            <Plus size={18} /> Agregar Paso Unificado (Merged)
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                ) : (
                    <div style={{ marginBottom: '2.5rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                            <h3 style={{ fontSize: '1.1rem', color: 'var(--text-secondary)', margin: 0, textTransform: 'uppercase', letterSpacing: '1px' }}>{locale === 'es' ? 'Procedimiento' : 'Procedure'}</h3>
                            {isEditing && (
                                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                    {locale === 'es' ? 'Use **texto** para negrita' : 'Use **text** for bold'}
                                </span>
                            )}
                        </div>
                        {isEditing ? (
                            <DndContext
                                sensors={sensors}
                                collisionDetection={closestCenter}
                                onDragStart={({ active }) => {
                                    const id = active.id as string;
                                    const idx = procSteps.findIndex(s => s.id === id);
                                    if (idx !== -1) setActiveDragStep({ id, step: procSteps[idx].text, idx });
                                }}
                                onDragEnd={({ active, over }) => {
                                    setActiveDragStep(null);
                                    if (!over || active.id === over.id) return;
                                    const oldIdx = procSteps.findIndex(s => s.id === (active.id as string));
                                    const newIdx = procSteps.findIndex(s => s.id === (over.id as string));
                                    if (oldIdx === -1 || newIdx === -1) return;
                                    updateProcSteps(arrayMove(procSteps, oldIdx, newIdx));
                                }}
                                onDragCancel={() => setActiveDragStep(null)}
                            >
                                <SortableContext
                                    items={procSteps.map(s => s.id)}
                                    strategy={verticalListSortingStrategy}
                                >
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                        {procSteps.map((step, idx) => (
                                            <SortableProcedureStep
                                                key={step.id}
                                                id={step.id}
                                                idx={idx}
                                                step={step.text}
                                                isEditing={isEditing}
                                                updateProcedure={updateProcedure}
                                                removeProcedureRow={removeProcedureRow}
                                                renderBoldText={renderBoldText}
                                            />
                                        ))}
                                    </div>
                                </SortableContext>
                                <DragOverlay>
                                    {activeDragStep && (
                                        <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', opacity: 0.9, background: 'var(--bg-secondary)', border: '1px solid var(--accent-primary)', borderRadius: '6px', padding: '0.5rem' }}>
                                            <GripVertical size={18} style={{ color: 'var(--text-secondary)', flexShrink: 0, marginTop: '6px' }} />
                                            <div style={{ background: 'var(--accent-primary)', color: 'white', width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '0.9rem', flexShrink: 0, marginTop: '2px' }}>
                                                {activeDragStep.idx + 1}
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                <p style={{ margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap', color: 'var(--text-primary)' }}>{activeDragStep.step || '(empty step)'}</p>
                                            </div>
                                        </div>
                                    )}
                                </DragOverlay>
                            </DndContext>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', counterReset: 'step-counter' }}>
                                {procList.map((step: string, idx: number) => (
                                    <div key={idx} style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                                        <div style={{ background: 'var(--accent-primary)', color: 'white', width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '0.9rem', flexShrink: 0, marginTop: '2px' }}>
                                            {idx + 1}
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <p style={{ margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{renderBoldText(step)}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                        {isEditing && (
                            <button onClick={addProcedureRow} style={{ marginTop: '1rem', background: 'transparent', border: '1px dashed var(--border)', padding: '0.5rem', width: '100%', color: 'var(--text-secondary)', borderRadius: '4px', cursor: 'pointer' }} onMouseOver={(e) => e.currentTarget.style.color = 'white'} onMouseOut={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}>
                                + Agregar Paso
                            </button>
                        )}
                    </div>
                )}

                {/* Chef Notes */}
                {docData.type !== 'EMPLATADO' && (
                    <div>
                        <h3 style={{ fontSize: '1.1rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '1px' }}>{locale === 'es' ? 'Notas del Chef' : 'Chef Notes'}</h3>
                        {isEditing ? (
                            <textarea
                                value={docData.chefNotes || ''}
                                onChange={e => setEditData({ ...docData, chefNotes: e.target.value })}
                                rows={4}
                                style={{ width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border)', padding: '1rem', borderRadius: '8px', color: 'var(--text-primary)', resize: 'vertical' }}
                            />
                        ) : (
                            <div style={{ background: 'rgba(255,215,0,0.05)', borderLeft: '4px solid #fbbf24', padding: '1rem', borderRadius: '0 8px 8px 0' }}>
                                <div style={{ margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.6, color: 'var(--text-primary)' }}>
                                    {renderBoldText(docData.chefNotes)}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {deleteConfirmOpen && selectedRecipe && (
                <div
                    onClick={() => setDeleteConfirmOpen(false)}
                    style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{ background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: '12px', padding: '2rem', width: '420px', maxWidth: '90%', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}
                    >
                        <h2 style={{ margin: 0, fontSize: '1.4rem' }}>
                            ¿Eliminar {selectedRecipe.type === 'RECETA' ? 'receta' : selectedRecipe.type === 'EMPLATADO' ? 'emplatado' : 'guía'}?
                        </h2>
                        <p style={{ margin: 0, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                            Estás a punto de eliminar <strong>"{selectedRecipe.name}"</strong>. Esta acción no se puede deshacer.
                        </p>
                        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                            <button
                                onClick={() => setDeleteConfirmOpen(false)}
                                className="btn-secondary"
                                style={{ padding: '0.6rem 1.2rem' }}
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleDelete}
                                disabled={isLoading}
                                style={{ padding: '0.6rem 1.2rem', background: 'var(--danger)', color: 'white', border: 'none', borderRadius: '8px', cursor: isLoading ? 'not-allowed' : 'pointer', fontWeight: 600, opacity: isLoading ? 0.7 : 1 }}
                            >
                                {isLoading ? 'Eliminando...' : 'Eliminar'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showHistory && (
                <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="glass-panel" style={{ width: '600px', maxWidth: '90%', maxHeight: '80vh', display: 'flex', flexDirection: 'column', padding: '2rem', background: 'var(--bg-primary)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '1rem' }}>
                            <h2 style={{ margin: 0 }}>{locale === 'es' ? 'Historial de Versiones' : 'Version History'}</h2>
                            <button onClick={() => setShowHistory(false)} style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer' }}><X size={24} /></button>
                        </div>
                        <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            {historyLogs.length === 0 ? (
                                <p style={{ color: 'var(--text-secondary)' }}>No history found.</p>
                            ) : (
                                historyLogs.map(log => (
                                    <div key={log.id} style={{ padding: '1rem', border: '1px solid var(--border)', borderRadius: '8px', background: 'var(--bg-secondary)' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                            <span style={{ fontWeight: 600 }}>{new Date(log.savedAt).toLocaleString()}</span>
                                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', background: 'var(--bg-primary)', border: '1px solid var(--border)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>{log.savedBy || 'System'}</span>
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                            <div><strong>Name:</strong> {log.name}</div>
                                            <div><strong>Yield:</strong> {log.yield || '-'}</div>
                                        </div>
                                        <div style={{ marginTop: '0.5rem', fontSize: '0.85rem' }}>
                                            <strong>Revision Date:</strong> {new Date(log.revisionDate).toLocaleDateString()}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
