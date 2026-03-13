'use client';

import { useState, useEffect } from 'react';
import { useLocale } from 'next-intl';
import { useAdmin } from '@/components/AdminContext';
import { BookOpen, Plus, FileText, Check, Pencil, Trash2, History, X, Save, ArrowLeft } from 'lucide-react';
import { getDigitalRecipes, createDigitalRecipe, updateDigitalRecipe, getRecipeHistory, deleteDigitalRecipe, getAvailablePrepRecipes } from '@/app/actions/recetario';
import { SearchableSelect } from '@/components/ui/SearchableSelect';

interface RecipeIngredient {
    ingredient: string;
    quantity: string;
    metric: string;
    notes: string;
}

export default function RecetarioPage() {
    const locale = useLocale();
    const { isAdmin } = useAdmin();

    const [recipes, setRecipes] = useState<any[]>([]);
    const [activeTab, setActiveTab] = useState('RECETA'); // RECETA, EMPLATADO, GUIA
    const [isLoading, setIsLoading] = useState(true);

    const [selectedRecipe, setSelectedRecipe] = useState<any>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [historyLogs, setHistoryLogs] = useState<any[]>([]);

    const [availablePreps, setAvailablePreps] = useState<any[]>([]);

    // Editor state
    const [editData, setEditData] = useState<any>(null);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setIsLoading(true);
        const [data, preps] = await Promise.all([getDigitalRecipes(), getAvailablePrepRecipes()]);
        setRecipes(data);
        setAvailablePreps(preps);
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
            chefNotes: '• Vida Útil:\n• ',
            linkedIngredientId: '',
        };
        setSelectedRecipe(null);
        setEditData(newData);
        setIsEditing(true);
    };

    const handleEdit = (recipe: any) => {
        const linked = availablePreps.find(p => p.digitalRecipeId === recipe.id);
        setSelectedRecipe(recipe);
        setEditData({ ...recipe, linkedIngredientId: linked ? linked.id : '' });
        setIsEditing(true);
    };

    const handleView = (recipe: any) => {
        setSelectedRecipe(recipe);
        setEditData(null);
        setIsEditing(false);
    };

    const handleSave = async () => {
        if (!editData.name) {
            alert(locale === 'es' ? 'El nombre es obligatorio' : 'Name is mandatory');
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
            alert('Error saving recipe');
        }
        setIsLoading(false);
    };

    const handleViewHistory = async (id: string) => {
        const h = await getRecipeHistory(id);
        setHistoryLogs(h);
        setShowHistory(true);
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

    const updateProcedure = (index: number, val: string) => {
        const arr = JSON.parse(editData.procedureJson || '[]');
        arr[index] = val;
        setEditData({ ...editData, procedureJson: JSON.stringify(arr) });
    };
    const addProcedureRow = () => {
        const arr = JSON.parse(editData.procedureJson || '[]');
        arr.push('');
        setEditData({ ...editData, procedureJson: JSON.stringify(arr) });
    };
    const removeProcedureRow = (index: number) => {
        const arr = JSON.parse(editData.procedureJson || '[]');
        arr.splice(index, 1);
        setEditData({ ...editData, procedureJson: JSON.stringify(arr) });
    };


    const filteredList = recipes.filter(r => r.type === activeTab);

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
                        <button className="btn-primary" onClick={handleCreateNew} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.6rem 1.2rem', borderRadius: '8px' }}>
                            <Plus size={18} />
                            {locale === 'es' ? 'Nueva Entrada' : 'New Entry'}
                        </button>
                    )}
                </div>

                <div className="glass-panel" style={{ padding: '1rem', display: 'flex', gap: '1rem', marginTop: '2rem', marginBottom: '1.5rem' }}>
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

                {isLoading ? (
                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading...</div>
                ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem' }}>
                        {filteredList.length === 0 ? (
                            <div style={{ padding: '2rem', color: 'var(--text-secondary)', textAlign: 'center', gridColumn: '1 / -1' }}>
                                {locale === 'es' ? 'No hay documentos en esta sección.' : 'No documents in this section.'}
                            </div>
                        ) : (
                            filteredList.map(recipe => (
                                <div key={recipe.id} onClick={() => handleView(recipe)} className="glass-panel" style={{ padding: '1.5rem', cursor: 'pointer', transition: 'transform 0.2s', display: 'flex', flexDirection: 'column', gap: '0.5rem' }} onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-4px)'} onMouseOut={(e) => e.currentTarget.style.transform = 'translateY(0)'}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                        <span style={{ background: 'rgba(59, 130, 246, 0.2)', color: '#60a5fa', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 600 }}>
                                            {recipe.recipeCode}
                                        </span>
                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                            ↻ {new Date(recipe.revisionDate).toLocaleDateString()}
                                        </span>
                                    </div>
                                    <h3 style={{ margin: '0.5rem 0', fontSize: '1.25rem' }}>{recipe.name}</h3>
                                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', flex: 1, margin: 0, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                                        {recipe.overview || 'Sin descripción'}
                                    </p>
                                    {isAdmin && (
                                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '0.5rem' }}>
                                            <button onClick={(e) => { e.stopPropagation(); handleEdit(recipe); }} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem', padding: '0.4rem' }} onMouseOver={(e) => e.currentTarget.style.color = 'white'} onMouseOut={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}>
                                                <Pencil size={14} /> Editar
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                )}
            </div>
        );
    }

    // ============================================
    // EDITOR OR VIEWER RENDER
    // ============================================
    const docData = isEditing ? editData : selectedRecipe;
    const ingrList = JSON.parse(docData.ingredientsJson || '[]');
    const procList = JSON.parse(docData.procedureJson || '[]');

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

            <div className="glass-panel" style={{ padding: '3rem', background: isEditing ? 'rgba(255,255,255,0.02)' : 'var(--bg-primary)', border: isEditing ? '1px dashed rgba(255,255,255,0.2)' : '1px solid rgba(255,255,255,0.05)', fontFamily: "'Times New Roman', Times, serif", fontSize: '12pt', color: 'var(--text-primary)' }}>
                {/* Header Section */}
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid rgba(255,255,255,0.1)', paddingBottom: '1.5rem', marginBottom: '2rem' }}>
                    <div style={{ flex: 1 }}>
                        <div style={{ color: '#60a5fa', fontWeight: 'bold', fontSize: '1.1rem', marginBottom: '0.5rem' }}>
                            {docData.recipeCode || 'NEW'}
                        </div>
                        {isEditing ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                <input
                                    value={docData.name}
                                    onChange={e => setEditData({ ...docData, name: e.target.value })}
                                    placeholder={locale === 'es' ? 'Título de la Receta' : 'Recipe Title'}
                                    style={{ fontSize: '2.5rem', fontWeight: 800, background: 'transparent', border: 'none', borderBottom: '1px solid rgba(255,255,255,0.2)', width: '100%', color: 'var(--text-primary)', padding: '0.5rem 0', fontFamily: 'inherit' }}
                                />
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
                                                            ingredient: comp.ingredient?.name || '',
                                                            quantity: comp.quantity?.toString() || '',
                                                            metric: comp.unit || '',
                                                            notes: ''
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
                            </div>
                        ) : (
                            <div>
                                <h1 style={{ fontSize: '2.5rem', margin: 0, fontFamily: 'inherit' }}>{docData.name}</h1>
                                {docData.id && availablePreps.find(p => p.digitalRecipeId === docData.id) && (
                                    <span style={{ fontSize: '0.9rem', color: 'var(--accent-primary)', background: 'rgba(59, 130, 246, 0.1)', padding: '0.2rem 0.5rem', borderRadius: '4px', marginTop: '0.5rem', display: 'inline-block' }}>
                                        Vinculado a: {availablePreps.find(p => p.digitalRecipeId === docData.id)?.name}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                    <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', gap: '0.5rem', justifyContent: 'flex-end', marginLeft: '2rem' }}>
                        <div>
                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', display: 'block' }}>{locale === 'es' ? 'Rendimiento' : 'Yield'}</span>
                            {isEditing ? (
                                <input
                                    value={docData.yield || ''}
                                    onChange={e => setEditData({ ...docData, yield: e.target.value })}
                                    placeholder="e.g. Approx. 5 Litros"
                                    style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', padding: '0.4rem', borderRadius: '4px', color: 'var(--text-primary)', textAlign: 'right', fontFamily: 'inherit' }}
                                />
                            ) : (
                                <span style={{ fontWeight: 600, fontSize: '14pt' }}>{docData.yield || '-'}</span>
                            )}
                        </div>
                        <div>
                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', display: 'block' }}>{locale === 'es' ? 'Fecha de Revisión' : 'Revision Date'}</span>
                            <span style={{ fontWeight: 600 }}>{docData.revisionDate ? new Date(docData.revisionDate).toLocaleDateString() : 'Pending'}</span>
                        </div>
                    </div>
                </div>

                {/* Overview */}
                <div style={{ marginBottom: '2.5rem' }}>
                    <h3 style={{ fontSize: '1.1rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '1px' }}>{locale === 'es' ? 'Visión General' : 'Overview'}</h3>
                    {isEditing ? (
                        <textarea
                            value={docData.overview || ''}
                            onChange={e => setEditData({ ...docData, overview: e.target.value })}
                            rows={3}
                            style={{ width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border)', padding: '1rem', borderRadius: '8px', color: 'var(--text-primary)', resize: 'vertical', fontFamily: 'inherit', fontSize: 'inherit' }}
                        />
                    ) : (
                        <p style={{ lineHeight: 1.6, margin: 0 }}>{docData.overview}</p>
                    )}
                </div>

                {/* Ingredients Table */}
                <div style={{ marginBottom: '2.5rem' }}>
                    <h3 style={{ fontSize: '1.1rem', color: 'var(--text-secondary)', marginBottom: '1rem', textTransform: 'uppercase', letterSpacing: '1px' }}>{locale === 'es' ? 'Ingredientes' : 'Ingredients'}</h3>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                                <th style={{ padding: '0.5rem', fontWeight: 600 }}>{locale === 'es' ? 'Ingrediente' : 'Ingredient'}</th>
                                <th style={{ padding: '0.5rem', fontWeight: 600 }}>{locale === 'es' ? 'Cantidad' : 'Quantity'}</th>
                                <th style={{ padding: '0.5rem', fontWeight: 600 }}>{locale === 'es' ? 'U. de Medida' : 'Metric'}</th>
                                <th style={{ padding: '0.5rem', fontWeight: 600 }}>{locale === 'es' ? 'Notas' : 'Notes'}</th>
                                {isEditing && <th style={{ padding: '0.5rem', width: '40px' }}></th>}
                            </tr>
                        </thead>
                        <tbody>
                            {ingrList.map((ingr: any, idx: number) => (
                                <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                    {isEditing ? (
                                        <>
                                            <td style={{ padding: '0.4rem' }}><input value={ingr.ingredient} onChange={e => updateIngredient(idx, 'ingredient', e.target.value)} style={{ width: '100%', padding: '0.4rem', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: 'inherit' }} /></td>
                                            <td style={{ padding: '0.4rem' }}><input value={ingr.quantity} onChange={e => updateIngredient(idx, 'quantity', e.target.value)} style={{ width: '100%', padding: '0.4rem', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: 'inherit' }} /></td>
                                            <td style={{ padding: '0.4rem' }}><input value={ingr.metric} onChange={e => updateIngredient(idx, 'metric', e.target.value)} style={{ width: '100%', padding: '0.4rem', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: 'inherit' }} /></td>
                                            <td style={{ padding: '0.4rem' }}><input value={ingr.notes} onChange={e => updateIngredient(idx, 'notes', e.target.value)} style={{ width: '100%', padding: '0.4rem', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-primary)', fontFamily: 'inherit', fontSize: 'inherit' }} /></td>
                                            <td style={{ padding: '0.4rem', textAlign: 'center' }}><button onClick={() => removeIngredientRow(idx)} style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer' }}><X size={16} /></button></td>
                                        </>
                                    ) : (
                                        <>
                                            <td style={{ padding: '0.8rem 0.5rem', fontWeight: 500 }}>{ingr.ingredient}</td>
                                            <td style={{ padding: '0.8rem 0.5rem' }}>{ingr.quantity}</td>
                                            <td style={{ padding: '0.8rem 0.5rem' }}>{ingr.metric}</td>
                                            <td style={{ padding: '0.8rem 0.5rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{ingr.notes}</td>
                                        </>
                                    )}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {isEditing && (
                        <button onClick={addIngredientRow} style={{ marginTop: '0.5rem', background: 'transparent', border: '1px dashed rgba(255,255,255,0.2)', padding: '0.5rem', width: '100%', color: 'var(--text-secondary)', borderRadius: '4px', cursor: 'pointer' }} onMouseOver={(e) => e.currentTarget.style.color = 'white'} onMouseOut={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}>
                            + Agregar Ingrediente
                        </button>
                    )}
                </div>

                {/* Procedure List */}
                <div style={{ marginBottom: '2.5rem' }}>
                    <h3 style={{ fontSize: '1.1rem', color: 'var(--text-secondary)', marginBottom: '1rem', textTransform: 'uppercase', letterSpacing: '1px' }}>{locale === 'es' ? 'Procedimiento' : 'Procedure'}</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', counterReset: 'step-counter' }}>
                        {procList.map((step: string, idx: number) => (
                            <div key={idx} style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                                <div style={{ background: 'var(--accent-primary)', color: 'white', width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '0.9rem', flexShrink: 0, marginTop: '2px' }}>
                                    {idx + 1}
                                </div>
                                <div style={{ flex: 1 }}>
                                    {isEditing ? (
                                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                                            <textarea value={step} onChange={e => updateProcedure(idx, e.target.value)} rows={2} style={{ width: '100%', background: 'transparent', border: '1px solid var(--border)', padding: '0.5rem', color: 'var(--text-primary)', resize: 'vertical', fontFamily: 'inherit', fontSize: 'inherit' }} />
                                            <button onClick={() => removeProcedureRow(idx)} style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: '0.5rem' }}><X size={16} /></button>
                                        </div>
                                    ) : (
                                        <p style={{ margin: 0, lineHeight: 1.6 }}>{step}</p>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                    {isEditing && (
                        <button onClick={addProcedureRow} style={{ marginTop: '1rem', background: 'transparent', border: '1px dashed rgba(255,255,255,0.2)', padding: '0.5rem', width: '100%', color: 'var(--text-secondary)', borderRadius: '4px', cursor: 'pointer' }} onMouseOver={(e) => e.currentTarget.style.color = 'white'} onMouseOut={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}>
                            + Agregar Paso
                        </button>
                    )}
                </div>

                {/* Chef Notes */}
                <div>
                    <h3 style={{ fontSize: '1.1rem', color: 'var(--text-secondary)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '1px' }}>{locale === 'es' ? 'Notas del Chef' : 'Chef Notes'}</h3>
                    {isEditing ? (
                        <textarea
                            value={docData.chefNotes || ''}
                            onChange={e => setEditData({ ...docData, chefNotes: e.target.value })}
                            rows={4}
                            style={{ width: '100%', background: 'var(--bg-secondary)', border: '1px solid var(--border)', padding: '1rem', borderRadius: '8px', color: 'var(--text-primary)', resize: 'vertical', fontFamily: 'inherit', fontSize: 'inherit' }}
                        />
                    ) : (
                        <div style={{ background: 'rgba(255,215,0,0.05)', borderLeft: '4px solid #fbbf24', padding: '1rem', borderRadius: '0 8px 8px 0' }}>
                            <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', lineHeight: 1.6, color: 'var(--text-primary)' }}>
                                {docData.chefNotes}
                            </pre>
                        </div>
                    )}
                </div>
            </div>

            {showHistory && (
                <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="glass-panel" style={{ width: '600px', maxWidth: '90%', maxHeight: '80vh', display: 'flex', flexDirection: 'column', padding: '2rem', background: 'var(--bg-primary)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1.5rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '1rem' }}>
                            <h2 style={{ margin: 0 }}>{locale === 'es' ? 'Historial de Versiones' : 'Version History'}</h2>
                            <button onClick={() => setShowHistory(false)} style={{ background: 'transparent', border: 'none', color: 'white', cursor: 'pointer' }}><X size={24} /></button>
                        </div>
                        <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            {historyLogs.length === 0 ? (
                                <p style={{ color: 'var(--text-secondary)' }}>No history found.</p>
                            ) : (
                                historyLogs.map(log => (
                                    <div key={log.id} style={{ padding: '1rem', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', background: 'var(--bg-secondary)' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                            <span style={{ fontWeight: 600 }}>{new Date(log.savedAt).toLocaleString()}</span>
                                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.05)', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>{log.savedBy || 'System'}</span>
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
