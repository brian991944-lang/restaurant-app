'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { X, Plus } from 'lucide-react';
import { savePrepRecipe } from '@/app/actions/inventory';
import { getDropdownOptions } from '@/app/actions/dropdownOptions';
import { ComponentRow } from './ComponentRow';
import { getConversionFactor } from '@/lib/conversion';
import { SearchableSelect } from '@/components/ui/SearchableSelect';

export default function RecipeBuilderModal({ isOpen, onClose, initialData, onSave, dbIngredients }: any) {
    const t = useTranslations('Inventory');
    const [metrics, setMetrics] = useState<any[]>([]);

    const [components, setComponents] = useState<any[]>([]);
    const [recipeYield, setRecipeYield] = useState<number>(1);
    const [selectedMetric, setSelectedMetric] = useState<string>('L');

    // LIVE COST STATES
    const [totalCalculatedCost, setTotalCalculatedCost] = useState<number>(0);
    const [currentPricePreview, setCurrentPricePreview] = useState<number>(0);

    useEffect(() => {
        if (isOpen) {
            getDropdownOptions('Metric').then(setMetrics);

            if (initialData?.composedOf && initialData.composedOf.length > 0) {
                setRecipeYield(initialData.portionWeightG || 1);
                setComponents(initialData.composedOf.map((c: any) => ({
                    id: Math.random().toString(),
                    ingredientId: c.ingredientId,
                    quantity: c.quantity.toString(),
                    unit: c.unit || 'units'
                })));
            } else {
                setRecipeYield(1);
                setComponents([]);
            }
            setSelectedMetric(initialData?.metric || 'L');
        }
    }, [isOpen, initialData]);

    const resolveCost = (item: any): number => {
        if (!item) return 0;
        return item.currentPrice || 0;
    };

    // Calculate Reactively
    useEffect(() => {
        let totalCost = 0;
        components.forEach((comp) => {
            const dbIng = dbIngredients.find((i: any) => i.id === comp.ingredientId);
            if (dbIng) {
                const baseUnit = dbIng.metric || 'Units';
                let lineCost = 0;
                if (baseUnit.toLowerCase() === 'units' || (comp.unit || '').toLowerCase() === 'units') {
                    lineCost = resolveCost(dbIng) * (parseFloat(comp.quantity) || 0);
                } else {
                    const cFactor = getConversionFactor(baseUnit, comp.unit || 'Units');
                    if (cFactor) {
                        const costPerTargetUnit = resolveCost(dbIng) / cFactor;
                        lineCost = costPerTargetUnit * (parseFloat(comp.quantity) || 0);
                    }
                }
                totalCost += lineCost;
            }
        });
        setTotalCalculatedCost(totalCost);

        const previewPrice = recipeYield > 0 ? (totalCost / recipeYield) : 0;
        setCurrentPricePreview(previewPrice);
    }, [components, recipeYield, dbIngredients]);

    const addComponent = () => {
        setComponents([...components, { id: Math.random().toString(), ingredientId: '', quantity: '0', unit: 'units' }]);
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
        const data = {
            name: formData.get('name') as string,
            nameEs: formData.get('name') as string,
            categoryName: 'Prep Items', // Hardcoded fix to bypass database error for category creation!
            metric: formData.get('metric') as string,
            batchSize: parseFloat(formData.get('batchSize') as string) || 1,
            currentPrice: currentPricePreview,
            autoTranslate: false,
            components: components.filter(c => c.ingredientId && parseFloat(c.quantity) > 0)
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
            <div className="glass-panel" style={{ width: '100%', maxWidth: '850px', padding: '2rem', maxHeight: '90vh', overflowY: 'auto', background: 'var(--bg-primary)' }}>
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
                                options={metrics.map(m => ({ value: m.name, label: m.name }))}
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
                            <button type="button" onClick={addComponent} className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.8rem', borderRadius: '6px', fontSize: '0.85rem' }}>
                                <Plus size={16} /> Add Ingredient
                            </button>
                        </div>

                        {components.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '2rem', border: '1px dashed rgba(255,255,255,0.2)', borderRadius: '8px', color: 'var(--text-secondary)' }}>
                                No ingredients added yet. Click "Add Ingredient" to build your recipe.
                            </div>
                        ) : (
                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                                <thead>
                                    <tr style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                                        <th style={{ padding: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Ingredient</th>
                                        <th style={{ padding: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', width: '100px' }}>Qty</th>
                                        <th style={{ padding: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Unidad</th>
                                        <th style={{ padding: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', textAlign: 'right' }}>Costo</th>
                                        <th style={{ padding: '0.75rem', width: '50px' }}></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {components.map((comp) => (
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

                        <div style={{ marginTop: '1.5rem', padding: '1.25rem', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', textAlign: 'center' }}>
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
                            {t('modal_save')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
