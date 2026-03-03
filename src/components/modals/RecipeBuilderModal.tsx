'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { X, Plus, Trash2 } from 'lucide-react';
import { savePrepRecipe } from '@/app/actions/inventory';
import { getDropdownOptions } from '@/app/actions/dropdownOptions';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { ALLOWED_METRICS, getConversionFactor } from '@/lib/conversion';

export default function RecipeBuilderModal({ isOpen, onClose, initialData, onSave, dbIngredients }: any) {
    const t = useTranslations('Inventory');
    const [categories, setCategories] = useState<any[]>([]);
    const [metrics, setMetrics] = useState<any[]>([]);
    const [autoTranslate, setAutoTranslate] = useState(true);

    const [components, setComponents] = useState<any[]>([]);
    const [recipeYield, setRecipeYield] = useState<number>(1);
    const [selectedMetric, setSelectedMetric] = useState<string>('L');

    useEffect(() => {
        if (isOpen) {
            getDropdownOptions('Metric').then(setMetrics);
            const allCats = Array.from(new Set(dbIngredients.map((i: any) => i.category?.name || 'Uncategorized'))).map(name => ({ id: name as string, name: name as string }));
            setCategories(allCats as any);

            if (initialData?.composedOf) {
                setRecipeYield(initialData.yieldPercent || 1);
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
    }, [isOpen, initialData, dbIngredients]);

    const getOptName = (name: string, isTranslated?: boolean, nameEs?: string) => {
        if (isTranslated === false) return name;
        if (nameEs && autoTranslate) return nameEs; // simplistic approach for dropdowns
        return name;
    };

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

    const resolveCost = (item: any): number => {
        if (!item) return 0;
        if (item.type === 'RAW') return item.currentPrice || 0;
        if (item.type === 'PROCESSED' || item.type === 'PREP_RECIPE') return item.currentPrice || 0;
        return item.currentPrice || 0;
    };

    const calculateTotalCost = () => {
        return components.reduce((acc, comp) => {
            const dbIng = dbIngredients.find((i: any) => i.id === comp.ingredientId);
            if (!dbIng) return acc;
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
            return acc + lineCost;
        }, 0);
    };

    const totalCalculatedCost = calculateTotalCost();
    const currentPricePreview = recipeYield > 0 ? (totalCalculatedCost / recipeYield) : 0;

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const data = {
            name: formData.get('name') as string,
            categoryName: formData.get('categoryName') as string,
            metric: formData.get('metric') as string,
            yieldPercent: parseFloat(formData.get('yieldPercent') as string) || 1,
            currentPrice: currentPricePreview,
            autoTranslate,
            components: components.filter(c => c.ingredientId)
        };

        const result = await savePrepRecipe(initialData?.id || null, data);
        if (result.success) {
            onSave(result.ingredient);
        } else {
            alert(result.error);
        }
    };

    if (!isOpen) return null;

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
            <div className="glass-panel" style={{ width: '100%', maxWidth: '800px', padding: '2rem', maxHeight: '90vh', overflowY: 'auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem' }}>
                    <div>
                        <h2 style={{ fontSize: '1.5rem', marginBottom: '0.25rem' }}>{initialData ? 'Edit Prep Recipe' : 'Add Prep Recipe'}</h2>
                        <p style={{ color: 'var(--text-secondary)' }}>Component Builder for sub-recipes securely updating exact recursive costs.</p>
                    </div>
                    <button type="button" onClick={onClose} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', borderRadius: '50%', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                        <X size={18} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Auto-Translate (ES):</span>
                        <label className="toggle-switch">
                            <input type="checkbox" checked={autoTranslate} onChange={(e) => setAutoTranslate(e.target.checked)} />
                            <span className="slider"></span>
                        </label>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Recipe Name</label>
                            <input name="name" className="input-field" placeholder="e.g. Huancaina Sauce" defaultValue={initialData?.name} required />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Category</label>
                            <input name="categoryName" className="input-field" placeholder="e.g. Sauces" defaultValue={initialData?.category || ''} required />
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Metric (Yield Unit)</label>
                            <select name="metric" className="input-field" value={selectedMetric} onChange={e => setSelectedMetric(e.target.value)} required>
                                {metrics.map(m => <option key={m.id} value={m.name}>{getOptName(m.name, m.isTranslated, m.nameEs)}</option>)}
                            </select>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Yield / Batch Size</label>
                            <input name="yieldPercent" type="number" step="0.01" min="0" className="input-field" placeholder="1" value={recipeYield} onChange={(e) => setRecipeYield(parseFloat(e.target.value) || 0)} required />
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
                                        <th style={{ padding: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', width: '120px' }}>Cant (Qty)</th>
                                        <th style={{ padding: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', width: '150px' }}>Unidad</th>
                                        <th style={{ padding: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', width: '110px', textAlign: 'right' }}>Costo</th>
                                        <th style={{ padding: '0.75rem', width: '50px' }}></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {components.map((comp) => (
                                        <tr key={comp.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                            <td style={{ padding: '0.5rem' }}>
                                                <SearchableSelect
                                                    value={comp.ingredientId}
                                                    onChange={(val) => updateComponent(comp.id, 'ingredientId', val)}
                                                    options={dbIngredients.filter((i: any) => i.id !== initialData?.id).map((item: any) => ({ value: item.id, label: item.name }))}
                                                    placeholder="Select..."
                                                />
                                            </td>
                                            <td style={{ padding: '0.5rem' }}>
                                                <input
                                                    type="number"
                                                    step="0.001"
                                                    value={comp.quantity}
                                                    onChange={e => updateComponent(comp.id, 'quantity', e.target.value)}
                                                    className="input-field"
                                                    style={{ padding: '0.6rem' }}
                                                    required
                                                />
                                            </td>
                                            <td style={{ padding: '0.5rem' }}>
                                                {(() => {
                                                    const dbIng = dbIngredients.find((i: any) => i.id === comp.ingredientId);
                                                    const baseUnit = dbIng ? (dbIng.metric || 'Units') : 'Units';
                                                    const options = baseUnit.toLowerCase() === 'units'
                                                        ? [{ value: 'Units', label: 'Units' }]
                                                        : ALLOWED_METRICS.filter(m => m.toLowerCase() !== 'units').map(m => ({ value: m, label: m }));

                                                    return (
                                                        <SearchableSelect
                                                            value={comp.unit}
                                                            onChange={val => updateComponent(comp.id, 'unit', val)}
                                                            options={options}
                                                            disabled={baseUnit.toLowerCase() === 'units'}
                                                        />
                                                    );
                                                })()}
                                            </td>
                                            <td style={{ padding: '0.5rem', textAlign: 'right' }}>
                                                {(() => {
                                                    const dbIng = dbIngredients.find((i: any) => i.id === comp.ingredientId);
                                                    if (!dbIng) return <span style={{ color: 'var(--text-secondary)' }}>$0.00</span>;
                                                    const baseUnit = dbIng.metric || 'Units';
                                                    let lineCost = 0;
                                                    if (baseUnit.toLowerCase() === 'units' || (comp.unit || '').toLowerCase() === 'units') {
                                                        lineCost = resolveCost(dbIng) * (parseFloat(comp.quantity) || 0);
                                                    } else {
                                                        const cFactor = getConversionFactor(baseUnit, comp.unit || 'Units');
                                                        if (cFactor) {
                                                            lineCost = (resolveCost(dbIng) / cFactor) * (parseFloat(comp.quantity) || 0);
                                                        } else {
                                                            return <span style={{ color: 'var(--danger)', fontSize: '0.8rem' }}>Err</span>;
                                                        }
                                                    }
                                                    return '$' + lineCost.toFixed(2);
                                                })()}
                                            </td>
                                            <td style={{ padding: '0.5rem', textAlign: 'center' }}>
                                                <button type="button" onClick={() => removeComponent(comp.id)} style={{ color: 'var(--danger)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                    <Trash2 size={18} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}

                        {components.length > 0 && (
                            <div style={{ marginTop: '1.5rem', padding: '1.25rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', textAlign: 'center' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Costo Total de la Receta (Total Batch Cost)</span>
                                    <span style={{ fontSize: '1.2rem', fontWeight: 600 }}>${totalCalculatedCost.toFixed(2)}</span>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Costo por {selectedMetric} (Cost per Yield Unit)</span>
                                    <span style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--accent-primary)' }}>${currentPricePreview.toFixed(2)}</span>
                                </div>
                            </div>
                        )}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1.5rem' }}>
                        <button type="button" onClick={onClose} className="btn-secondary" style={{ padding: '0.6rem 1rem', borderRadius: '8px', background: 'transparent' }}>
                            {t('modal_cancel')}
                        </button>
                        <button type="submit" className="btn-primary" style={{ padding: '0.6rem 1.5rem', borderRadius: '8px' }}>
                            {t('modal_save')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
