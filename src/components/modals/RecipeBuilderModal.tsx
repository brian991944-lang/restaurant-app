'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { X, Plus, Trash2 } from 'lucide-react';
import { savePrepRecipe } from '@/app/actions/inventory';
import { getDropdownOptions } from '@/app/actions/dropdownOptions';

export default function RecipeBuilderModal({ isOpen, onClose, initialData, onSave, dbIngredients }: any) {
    const t = useTranslations('Inventory');
    const [categories, setCategories] = useState<any[]>([]);
    const [metrics, setMetrics] = useState<any[]>([]);
    const [autoTranslate, setAutoTranslate] = useState(true);

    const [components, setComponents] = useState<any[]>([]);

    useEffect(() => {
        if (isOpen) {
            getDropdownOptions('Metric').then(setMetrics);
            const allCats = Array.from(new Set(dbIngredients.map((i: any) => i.category?.name || 'Uncategorized'))).map(name => ({ id: name, name }));
            setCategories(allCats as any);

            if (initialData?.composedOf) {
                setComponents(initialData.composedOf.map((c: any) => ({
                    id: Math.random().toString(),
                    ingredientId: c.ingredientId,
                    quantity: c.quantity
                })));
            } else {
                setComponents([]);
            }
        }
    }, [isOpen, initialData, dbIngredients]);

    const getOptName = (name: string, isTranslated?: boolean, nameEs?: string) => {
        if (isTranslated === false) return name;
        if (nameEs && autoTranslate) return nameEs; // simplistic approach for dropdowns
        return name;
    };

    const addComponent = () => {
        setComponents([...components, { id: Math.random().toString(), ingredientId: '', quantity: 1 }]);
    };

    const removeComponent = (id: string) => {
        setComponents(components.filter(c => c.id !== id));
    };

    const updateComponent = (id: string, field: string, value: any) => {
        setComponents(components.map(c => c.id === id ? { ...c, [field]: value } : c));
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const data = {
            name: formData.get('name') as string,
            categoryName: formData.get('categoryName') as string,
            metric: formData.get('metric') as string,
            yieldPercent: parseFloat(formData.get('yieldPercent') as string) || 1,
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
                    <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', borderRadius: '50%', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
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
                            <select name="metric" className="input-field" defaultValue={initialData?.metric || 'L'} required>
                                {metrics.map(m => <option key={m.id} value={m.name}>{getOptName(m.name, m.isTranslated, m.nameEs)}</option>)}
                            </select>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Yield / Batch Size</label>
                            <input name="yieldPercent" type="number" step="0.01" min="0" className="input-field" placeholder="1" defaultValue={initialData?.yieldPercent || 1} required />
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
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                {components.map((comp, index) => (
                                    <div key={comp.id} style={{ display: 'grid', gridTemplateColumns: '1fr 120px 40px', gap: '1rem', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '0.75rem 1rem', borderRadius: '8px' }}>
                                        <select
                                            className="input-field"
                                            value={comp.ingredientId}
                                            onChange={(e) => updateComponent(comp.id, 'ingredientId', e.target.value)}
                                            required
                                        >
                                            <option value="" disabled>Select Ingredient...</option>
                                            {dbIngredients.filter((i: any) => i.id !== initialData?.id).sort((a: any, b: any) => a.name.localeCompare(b.name)).map((dbI: any) => (
                                                <option key={dbI.id} value={dbI.id}>{dbI.name} ({dbI.metric})</option>
                                            ))}
                                        </select>
                                        <input
                                            type="number"
                                            step="0.001"
                                            min="0"
                                            className="input-field"
                                            placeholder="Qty"
                                            value={comp.quantity}
                                            onChange={(e) => updateComponent(comp.id, 'quantity', e.target.value)}
                                            required
                                        />
                                        <button type="button" onClick={() => removeComponent(comp.id)} style={{ color: 'var(--danger)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '0.5rem' }}>
                                            <Trash2 size={18} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1.5rem' }}>
                        <button type="button" onClick={onClose} style={{ padding: '0.6rem 1rem', borderRadius: '8px', color: 'var(--text-secondary)', background: 'transparent' }}>
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
