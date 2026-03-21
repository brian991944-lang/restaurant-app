'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { X, Plus, Trash2 } from 'lucide-react';
import { savePrepRecipe } from '@/app/actions/inventory';
import { ComponentRow } from './ComponentRow';
import { getConversionFactor, ALLOWED_METRICS } from '@/lib/conversion';
import { SearchableSelect } from '@/components/ui/SearchableSelect';

export default function RecipeBuilderModal({ isOpen, onClose, initialData, onSave, dbIngredients }: any) {
    const t = useTranslations('Inventory');

    const [groups, setGroups] = useState<{ id: string, name: string }[]>([]);
    const [components, setComponents] = useState<any[]>([]);
    const [recipeYield, setRecipeYield] = useState<number>(1);
    const [selectedMetric, setSelectedMetric] = useState<string>('L');

    // LIVE COST STATES
    const [totalCalculatedCost, setTotalCalculatedCost] = useState<number>(0);
    const [currentPricePreview, setCurrentPricePreview] = useState<number>(0);

    useEffect(() => {
        if (isOpen) {
            if (initialData?.composedOf && initialData.composedOf.length > 0) {
                setRecipeYield(initialData.portionWeightG || 1);

                // Extract unique group names
                const uniqueGroupNames = Array.from(new Set(initialData.composedOf.map((c: any) => c.groupName || 'Components')));
                const newGroups = uniqueGroupNames.map((name: any) => ({ id: Math.random().toString(), name }));
                setGroups(newGroups);

                setComponents(initialData.composedOf.map((c: any) => ({
                    id: Math.random().toString(),
                    groupId: newGroups.find(g => g.name === (c.groupName || 'Components'))?.id,
                    ingredientId: c.ingredientId,
                    quantity: c.quantity.toString(),
                    unit: c.unit || 'units'
                })));
            } else {
                setRecipeYield(1);
                const defaultGroupId = Math.random().toString();
                setGroups([{ id: defaultGroupId, name: 'Main Components' }]);
                setComponents([]);
            }
            setSelectedMetric(initialData?.metric || 'L');
        }
    }, [isOpen, initialData]);

    const resolveCost = (item: any): number => {
        if (!item) return 0;
        return item.currentPrice || 0;
    };

    const getComponentCost = (comp: any) => {
        const dbIng = dbIngredients.find((i: any) => i.id === comp.ingredientId);
        if (!dbIng) return 0;
        const baseUnit = dbIng.metric || 'Units';
        let lineCost = 0;
        if (baseUnit.toLowerCase() === 'units' || (comp.unit || '').toLowerCase() === 'units') {
            lineCost = resolveCost(dbIng) * (parseFloat(comp.quantity) || 0);
        } else {
            const cFactor = getConversionFactor(baseUnit, comp.unit || 'Units');
            if (cFactor) {
                lineCost = (resolveCost(dbIng) / cFactor) * (parseFloat(comp.quantity) || 0);
            }
        }
        return lineCost;
    };

    // Calculate Reactively
    useEffect(() => {
        let totalCost = 0;
        components.forEach((comp) => {
            totalCost += getComponentCost(comp);
        });
        setTotalCalculatedCost(totalCost);

        const previewPrice = recipeYield > 0 ? (totalCost / recipeYield) : 0;
        setCurrentPricePreview(previewPrice);
    }, [components, recipeYield, dbIngredients]);

    const addGroup = () => {
        setGroups([...groups, { id: Math.random().toString(), name: 'New Group' }]);
    };

    const removeGroup = (id: string) => {
        setGroups(groups.filter(g => g.id !== id));
        setComponents(components.filter(c => c.groupId !== id));
    };

    const updateGroupName = (id: string, name: string) => {
        setGroups(groups.map(g => g.id === id ? { ...g, name } : g));
    };

    const addComponent = (groupId: string) => {
        setComponents([...components, { id: Math.random().toString(), groupId, ingredientId: '', quantity: '0', unit: 'units' }]);
    };

    const removeComponent = (id: string) => {
        setComponents(components.filter(c => c.id !== id));
    };

    const updateComponent = (id: string, field: string, value: any) => {
        if (field === 'ingredientId') {
            const selectedItem = dbIngredients.find((i: any) => i.id === value);
            setComponents(components.map(c => c.id === id ? { ...c, ingredientId: value, unit: selectedItem?.metric || 'units' } : c));
        } else {
            setComponents(components.map(c => c.id === id ? { ...c, [field]: value } : c));
        }
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);

        // Map elements back to a flat array but preserving the name
        const finalComponents = components
            .filter(c => c.ingredientId && parseFloat(c.quantity) > 0)
            .map(c => {
                const groupName = groups.find(g => g.id === c.groupId)?.name || 'Main Components';
                return { ...c, groupName };
            });

        const data = {
            name: formData.get('name') as string,
            nameEs: formData.get('name') as string,
            categoryName: 'Prep Items', // Hardcoded fix to bypass database error for category creation!
            metric: formData.get('metric') as string,
            batchSize: parseFloat(formData.get('batchSize') as string) || 1,
            currentPrice: currentPricePreview,
            autoTranslate: false,
            components: finalComponents
        };

        const result = await savePrepRecipe(initialData?.id || null, data);
        if (result.success) {
            onSave(result.ingredient);
        } else {
            alert("Database Error: " + (result.error || "Failed to save prep recipe"));
        }
    };

    if (!isOpen) return null;

    const availableIngredients = dbIngredients.filter((i: any) => i.id !== initialData?.id).sort((a: any, b: any) => a.name.localeCompare(b.name));

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
            <div className="glass-panel" style={{ width: '100%', maxWidth: '900px', padding: '2rem', maxHeight: '90vh', overflowY: 'auto', background: 'var(--bg-primary)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '1rem' }}>
                    <div>
                        <h2 style={{ fontSize: '1.4rem', fontWeight: 600, color: 'var(--text-primary)' }}>{initialData ? 'Edit Prep Recipe' : 'Add Prep Recipe'}</h2>
                        <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Dynamically calculate costs against raw ingredients</span>
                    </div>
                    <button type="button" onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                        <X size={24} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                            <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Recipe Name</label>
                            <input name="name" className="input-field" placeholder="e.g. Salsa Huancaina" defaultValue={initialData?.name} required />
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                            <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Metric (Yield Unit)</label>
                            <SearchableSelect
                                name="metric"
                                value={selectedMetric}
                                onChange={setSelectedMetric}
                                options={ALLOWED_METRICS.map(m => ({ value: m, label: m }))}
                                placeholder="Select batch unit..."
                                required
                            />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                            <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Yield / Batch Size</label>
                            <input name="batchSize" type="number" step="0.01" min="0" className="input-field" placeholder="1" value={recipeYield} onChange={(e) => setRecipeYield(parseFloat(e.target.value) || 0)} required />
                        </div>
                    </div>

                    <div style={{ marginTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '1.5rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                            <h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Components</h3>
                        </div>

                        {groups.map((group, index) => {
                            const groupComps = components.filter(c => c.groupId === group.id);
                            const groupCost = groupComps.reduce((sum, comp) => sum + getComponentCost(comp), 0);
                            return (
                                <div key={group.id} className="glass-panel" style={{ padding: '1.5rem', marginBottom: '1.5rem', background: 'var(--bg-glass)', border: 'var(--glass-border)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid rgba(128,128,128,0.2)', paddingBottom: '1rem' }}>
                                        <input
                                            value={group.name}
                                            onChange={e => updateGroupName(group.id, e.target.value)}
                                            placeholder="Group Name (e.g. Relleno) - REQUIRED"
                                            style={{ background: 'rgba(128,128,128,0.08)', border: '1px solid rgba(128,128,128,0.2)', padding: '0.5rem 1rem', borderRadius: '6px', color: 'var(--text-primary)', fontSize: '1.1rem', fontWeight: 600, outline: 'none', minWidth: '300px' }}
                                            required
                                        />
                                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                                            <button type="button" onClick={() => addComponent(group.id)} className="btn-secondary" style={{ padding: '0.3rem 0.6rem', fontSize: '0.8rem', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                                <Plus size={14} /> Add Ingredient
                                            </button>
                                            <button type="button" onClick={() => removeGroup(group.id)} style={{ color: 'var(--danger)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '0.3rem' }} title="Remove Group">
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </div>

                                    {groupComps.length === 0 ? (
                                        <div style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                                            No items. Click "Add Ingredient" to start building this group.
                                        </div>
                                    ) : (
                                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', marginTop: '0.5rem' }}>
                                            <thead>
                                                <tr style={{ borderBottom: '1px solid rgba(128,128,128,0.2)' }}>
                                                    <th style={{ padding: '0.5rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Ingredient</th>
                                                    <th style={{ padding: '0.5rem', fontWeight: 500, color: 'var(--text-secondary)', width: '120px' }}>Qty</th>
                                                    <th style={{ padding: '0.5rem', fontWeight: 500, color: 'var(--text-secondary)', width: '150px' }}>Unidad</th>
                                                    <th style={{ padding: '0.5rem', fontWeight: 500, color: 'var(--text-secondary)', textAlign: 'right', width: '100px' }}>Costo</th>
                                                    <th style={{ padding: '0.5rem', width: '40px' }}></th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {groupComps.map((comp) => (
                                                    <ComponentRow
                                                        key={comp.id}
                                                        comp={comp}
                                                        dbIngredients={availableIngredients}
                                                        updateComponent={updateComponent}
                                                        removeComponent={removeComponent}
                                                        resolveCost={resolveCost}
                                                    />
                                                ))}
                                            </tbody>
                                        </table>
                                    )}

                                    {groupComps.length > 0 && (
                                        <div style={{ textAlign: 'right', marginTop: '1rem', fontSize: '0.95rem', color: 'var(--text-secondary)' }}>
                                            Subtotal ({group.name}): <strong style={{ color: 'var(--text-primary)', marginLeft: '0.5rem' }}>${groupCost.toFixed(2)}</strong>
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                        <button type="button" onClick={addGroup} className="btn-secondary" style={{ width: '100%', padding: '1rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', border: '2px dashed var(--accent-primary)', color: 'var(--text-primary)', background: 'rgba(128,128,128,0.05)', borderRadius: '8px', opacity: 0.9, transition: 'opacity 0.2s', fontWeight: 600 }} onMouseOver={e => e.currentTarget.style.opacity = '1'} onMouseOut={e => e.currentTarget.style.opacity = '0.9'}>
                            <Plus size={18} /> Agregar Otro Componente (Add Block)
                        </button>

                        <div style={{ marginTop: '2rem', padding: '1.25rem', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', textAlign: 'center' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Costo Total de la Receta (Total Batch Cost)</span>
                                <span style={{ fontSize: '1.5rem', fontWeight: 700, color: '#007bff' }}>${totalCalculatedCost.toFixed(2)}</span>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Costo por {selectedMetric || 'Unit'} (Cost per Yield Unit)</span>
                                <span style={{ fontSize: '1.5rem', fontWeight: 700, color: '#007bff' }}>${currentPricePreview.toFixed(2)}</span>
                            </div>
                        </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1rem' }}>
                        <button type="button" onClick={onClose} className="btn-secondary" style={{ padding: '0.6rem 1rem', borderRadius: '8px', background: 'transparent' }}>
                            {t('modal_cancel')}
                        </button>
                        <button type="submit" className="btn-primary" style={{ padding: '0.6rem 2rem', borderRadius: '8px', fontWeight: 600 }}>
                            Guardar Receta
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
