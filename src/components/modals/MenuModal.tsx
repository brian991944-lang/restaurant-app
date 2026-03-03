'use client';

import { Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getInventory } from '@/app/actions/inventory';
import { fetchCloverMenuItems, fetchCloverModifiers } from '@/app/actions/clover';
import { getConversionFactor, ALLOWED_METRICS } from '@/lib/conversion';
import { calculateRecipeCost, resolveIngredientCost } from '@/lib/calculations';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { useLocale } from 'next-intl';

interface MenuModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: any) => void;
    initialData?: any;
}

export default function MenuModal({ isOpen, onClose, onSave, initialData }: MenuModalProps) {
    const locale = useLocale();
    const [ingredientsList, setIngredientsList] = useState<any[]>([]);

    // Form state
    const [name, setName] = useState('');
    const [category, setCategory] = useState('');
    const [salePrice, setSalePrice] = useState('0');
    const [targetFoodCostPct, setTargetFoodCostPct] = useState('25.0');
    const [cloverId, setCloverId] = useState('');
    const [hasInventoryModifiers, setHasInventoryModifiers] = useState(false);
    const [ingredients, setIngredients] = useState<{ id: string, ingredientId: string, quantity: string, unit: string }[]>([]);
    const [modifiers, setModifiers] = useState<{ id: string, name: string, cloverModifierId: string, ingredients: { id: string, ingredientId: string, quantity: string }[] }[]>([]);

    const [cloverItems, setCloverItems] = useState<{ id: string, name: string }[]>([]);
    const [cloverModifiersOpt, setCloverModifiersOpt] = useState<{ id: string, name: string, group: string }[]>([]);

    useEffect(() => {
        if (isOpen) {
            getInventory().then(setIngredientsList);
            fetchCloverMenuItems().then(setCloverItems);
            fetchCloverModifiers().then(setCloverModifiersOpt);

            if (initialData) {
                setName(initialData.name);
                setCategory(initialData.category || '');
                setSalePrice(initialData.salePrice.toString());
                setTargetFoodCostPct(initialData.targetFoodCostPct.toString());
                setIngredients(initialData.recipeIngredients?.map((ing: any) => ({
                    id: Math.random().toString(),
                    ingredientId: ing.ingredientId,
                    quantity: ing.quantity.toString(),
                    unit: ing.unit || 'units'
                })) || []);
                setCloverId(initialData.cloverId || '');
                setHasInventoryModifiers(initialData.hasInventoryModifiers || false);
                setModifiers(initialData.modifiers?.map((mod: any) => ({
                    id: Math.random().toString(),
                    name: mod.name,
                    cloverModifierId: mod.cloverModifierId,
                    ingredients: mod.ingredients?.map((ing: any) => ({
                        id: Math.random().toString(),
                        ingredientId: ing.ingredientId,
                        quantity: ing.quantity.toString()
                    })) || []
                })) || []);
            } else {
                setName('');
                setCategory('');
                setSalePrice('0');
                setTargetFoodCostPct('25.0');
                setCloverId('');
                setHasInventoryModifiers(false);
                setIngredients([]);
                setModifiers([]);
            }
        }
    }, [isOpen, initialData]);

    const handleAddIngredient = () => {
        setIngredients([...ingredients, { id: Math.random().toString(), ingredientId: '', quantity: '0', unit: 'units' }]);
    };

    const handleRemoveIngredient = (id: string) => {
        setIngredients(ingredients.filter(ing => ing.id !== id));
    };

    const handleIngredientChange = (id: string, field: string, value: string) => {
        if (field === 'ingredientId') {
            const selectedItem = ingredientsList.find(i => i.id === value);
            setIngredients(ingredients.map(ing =>
                ing.id === id ? { ...ing, ingredientId: value, unit: selectedItem?.metric || 'units' } : ing
            ));
        } else {
            setIngredients(ingredients.map(ing =>
                ing.id === id ? { ...ing, [field]: value } : ing
            ));
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSave({
            name,
            category,
            salePrice: parseFloat(salePrice) || 0,
            targetFoodCostPct: parseFloat(targetFoodCostPct) || 25,
            cloverId: cloverId || null,
            hasInventoryModifiers,
            ingredients: ingredients.map(ing => ({
                ingredientId: ing.ingredientId,
                quantity: parseFloat(ing.quantity) || 0,
                unit: ing.unit
            })).filter(ing => ing.ingredientId && ing.quantity > 0),
            modifiers: modifiers.map(mod => ({
                name: mod.name,
                cloverModifierId: mod.cloverModifierId,
                ingredients: mod.ingredients.map(ing => ({
                    ingredientId: ing.ingredientId,
                    quantity: parseFloat(ing.quantity) || 0
                })).filter(ing => ing.ingredientId && ing.quantity > 0)
            }))
        });
    };

    if (!isOpen) return null;

    const calculateTotalCost = () => {
        return calculateRecipeCost(ingredients, ingredientsList);
    };

    const totalCalculatedCost = calculateTotalCost();
    const currentFoodCostPct = parseFloat(salePrice) > 0 ? (totalCalculatedCost / parseFloat(salePrice)) * 100 : 0;

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50
        }}>
            <div className="glass-panel" style={{ width: '100%', maxWidth: '700px', maxHeight: '90vh', overflowY: 'auto', padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem', animation: 'fadeIn 0.2s ease-out', background: 'var(--bg-primary)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '1rem' }}>
                    <h2 style={{ fontSize: '1.5rem', margin: 0 }}>{initialData ? 'Edit Menu Item' : 'Add Menu Item'}</h2>
                    <button onClick={onClose} style={{ color: 'var(--text-secondary)', padding: '0.25rem' }}><X size={20} /></button>
                </div>

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Menu Item Name</label>
                            <input value={name} onChange={e => setName(e.target.value)} type="text" className="input-field" placeholder="e.g. Lomo Saltado" required />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Category</label>
                            <input value={category} onChange={e => setCategory(e.target.value)} type="text" className="input-field" placeholder="e.g. Entrees" required />
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Selling Price ($)</label>
                            <input value={salePrice} onChange={e => setSalePrice(e.target.value)} type="number" step="0.01" className="input-field" placeholder="25.00" required />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Target Food Cost %</label>
                            <input value={targetFoodCostPct} onChange={e => setTargetFoodCostPct(e.target.value)} type="number" step="0.1" className="input-field" placeholder="25.0" required />
                        </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', background: 'rgba(59, 130, 246, 0.05)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(59, 130, 246, 0.1)' }}>
                        <label style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>POS Item Link (Clover)</label>
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Bind this menu dish permanently to a Clover POS item.</p>
                        <SearchableSelect
                            value={cloverId}
                            onChange={(val) => setCloverId(val)}
                            options={[{ value: '', label: 'None' }, ...cloverItems.map(item => ({ value: item.id, label: `${item.name} - ${item.id}` }))]}
                            placeholder="Select a Clover Item..."
                        />
                    </div>

                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '1.5rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                            <h3 style={{ fontSize: '1.1rem', margin: 0 }}>Recipe Builder (Bill of Materials)</h3>
                            <button type="button" onClick={handleAddIngredient} className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}>
                                <Plus size={14} /> Add Ingredient
                            </button>
                        </div>

                        {ingredients.length === 0 ? (
                            <div style={{ padding: '2rem', textAlign: 'center', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', color: 'var(--text-secondary)' }}>
                                No ingredients added yet. Build your recipe!
                            </div>
                        ) : (
                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                                <thead>
                                    <tr style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                                        <th style={{ padding: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Ingredient</th>
                                        <th style={{ padding: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', width: '150px' }}>Qty (e.g. 0.25)</th>
                                        <th style={{ padding: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', width: '120px' }}>Metric</th>
                                        <th style={{ padding: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', width: '100px', textAlign: 'right' }}>{locale === 'es' ? 'Costo' : 'Cost'}</th>
                                        <th style={{ padding: '0.75rem', width: '60px' }}></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {ingredients.map((ing) => (
                                        <tr key={ing.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                            <td style={{ padding: '0.5rem' }}>
                                                <SearchableSelect
                                                    value={ing.ingredientId}
                                                    onChange={(val) => handleIngredientChange(ing.id, 'ingredientId', val)}
                                                    options={ingredientsList.map(item => ({ value: item.id, label: item.name }))}
                                                    placeholder="Select..."
                                                    required
                                                />
                                            </td>
                                            <td style={{ padding: '0.5rem' }}>
                                                <input
                                                    type="number"
                                                    step="0.001"
                                                    value={ing.quantity}
                                                    onChange={e => handleIngredientChange(ing.id, 'quantity', e.target.value)}
                                                    className="input-field"
                                                    style={{ padding: '0.6rem' }}
                                                    required
                                                />
                                            </td>
                                            <td style={{ padding: '0.5rem' }}>
                                                {(() => {
                                                    const dbIng = ingredientsList.find(i => i.id === ing.ingredientId);
                                                    const baseUnit = dbIng ? (dbIng.metric || 'Units') : 'Units';

                                                    const options = baseUnit.toLowerCase() === 'units'
                                                        ? [{ value: 'Units', label: 'Units' }]
                                                        : ALLOWED_METRICS.filter(m => m.toLowerCase() !== 'units').map(m => ({ value: m, label: m }));

                                                    return (
                                                        <SearchableSelect
                                                            value={ing.unit}
                                                            onChange={val => handleIngredientChange(ing.id, 'unit', val)}
                                                            options={options}
                                                            disabled={baseUnit.toLowerCase() === 'units'}
                                                        />
                                                    );
                                                })()}
                                            </td>
                                            <td style={{ padding: '0.5rem', textAlign: 'right' }}>
                                                {(() => {
                                                    const dbIng = ingredientsList.find(i => i.id === ing.ingredientId);
                                                    if (!dbIng) return '$0.00';

                                                    const baseUnit = dbIng.metric || 'Units';
                                                    let lineCost = 0;

                                                    if (baseUnit.toLowerCase() === 'units' || ing.unit.toLowerCase() === 'units') {
                                                        const unitCost = resolveIngredientCost(dbIng, ingredientsList);
                                                        lineCost = unitCost * (parseFloat(ing.quantity) || 0);
                                                    } else {
                                                        const cFactor = getConversionFactor(baseUnit, ing.unit);
                                                        if (cFactor) {
                                                            const costPerTargetUnit = resolveIngredientCost(dbIng, ingredientsList) / cFactor;
                                                            lineCost = costPerTargetUnit * (parseFloat(ing.quantity) || 0);
                                                        } else {
                                                            return <span style={{ color: 'var(--warning)', fontSize: '0.8rem' }}>{locale === 'es' ? 'Unidad Inválida' : 'Invalid Unit'}</span>;
                                                        }
                                                    }

                                                    return `$${lineCost.toFixed(2)}`;
                                                })()}
                                            </td>
                                            <td style={{ padding: '0.5rem', textAlign: 'center' }}>
                                                <button type="button" onClick={() => handleRemoveIngredient(ing.id)} style={{ color: 'var(--danger)', padding: '0.4rem' }}>
                                                    <Trash2 size={16} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}

                        {ingredients.length > 0 && (
                            <div style={{ marginTop: '1.5rem', padding: '1.25rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', textAlign: 'center' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Total Recipe Cost</span>
                                    <span style={{ fontSize: '1.2rem', fontWeight: 600 }}>${totalCalculatedCost.toFixed(2)}</span>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Selling Price</span>
                                    <span style={{ fontSize: '1.2rem', fontWeight: 600 }}>${parseFloat(salePrice).toFixed(2)}</span>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                    <span style={{ fontSize: '0.8rem', color: currentFoodCostPct > parseFloat(targetFoodCostPct) ? 'var(--danger)' : 'var(--text-secondary)' }}>Actual Food Cost %</span>
                                    <span style={{ fontSize: '1.2rem', fontWeight: 600, color: currentFoodCostPct > parseFloat(targetFoodCostPct) ? 'var(--danger)' : 'var(--text-primary)' }}>{currentFoodCostPct.toFixed(1)}%</span>
                                </div>
                            </div>
                        )}
                    </div>

                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '1.5rem' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '1rem', fontWeight: 500 }}>
                            <input type="checkbox" checked={hasInventoryModifiers} onChange={e => setHasInventoryModifiers(e.target.checked)} style={{ width: '18px', height: '18px' }} />
                            Does this item have inventory-relevant modifiers?
                        </label>

                        {hasInventoryModifiers && (
                            <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                {modifiers.map(mod => {
                                    const modCost = mod.ingredients.reduce((acc, ing) => {
                                        const dbIng = ingredientsList.find(i => i.id === ing.ingredientId);
                                        return acc + (dbIng ? resolveIngredientCost(dbIng, ingredientsList) * (parseFloat(ing.quantity) || 0) : 0);
                                    }, 0);

                                    return (
                                        <div key={mod.id} style={{ background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                                <div style={{ display: 'flex', gap: '1rem', flex: 1, paddingRight: '1rem' }}>
                                                    <input value={mod.name} onChange={e => setModifiers(modifiers.map(m => m.id === mod.id ? { ...m, name: e.target.value } : m))} placeholder="Modifier Title e.g. Add Shrimp" className="input-field" required />
                                                    <div style={{ flex: 1 }}>
                                                        <SearchableSelect
                                                            value={mod.cloverModifierId}
                                                            onChange={(val) => setModifiers(modifiers.map(m => m.id === mod.id ? { ...m, cloverModifierId: val } : m))}
                                                            options={cloverModifiersOpt.map(m => ({ value: m.id, label: `${m.name} (${m.group})` }))}
                                                            placeholder="Clover Modifier ID"
                                                        />
                                                    </div>
                                                </div>
                                                <button type="button" onClick={() => setModifiers(modifiers.filter(m => m.id !== mod.id))} style={{ color: 'var(--danger)' }}><Trash2 size={18} /></button>
                                            </div>
                                            <div>
                                                {mod.ingredients.map(ing => (
                                                    <div key={ing.id} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                                        <div style={{ flex: 2 }}>
                                                            <SearchableSelect
                                                                value={ing.ingredientId}
                                                                onChange={(val) => setModifiers(modifiers.map(m => m.id === mod.id ? { ...m, ingredients: m.ingredients.map(i => i.id === ing.id ? { ...i, ingredientId: val } : i) } : m))}
                                                                options={ingredientsList.map(item => ({ value: item.id, label: item.name }))}
                                                                placeholder="Ingredient..."
                                                            />
                                                        </div>
                                                        <input
                                                            type="number"
                                                            step="0.001"
                                                            className="input-field"
                                                            style={{ flex: 1 }}
                                                            placeholder="Qty"
                                                            value={ing.quantity}
                                                            onChange={e => setModifiers(modifiers.map(m => m.id === mod.id ? { ...m, ingredients: m.ingredients.map(i => i.id === ing.id ? { ...i, quantity: e.target.value } : i) } : m))}
                                                        />
                                                        <button type="button" onClick={() => setModifiers(modifiers.map(m => m.id === mod.id ? { ...m, ingredients: m.ingredients.filter(i => i.id !== ing.id) } : m))} style={{ color: 'var(--danger)', padding: '0 0.5rem' }}><X size={16} /></button>
                                                    </div>
                                                ))}
                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem' }}>
                                                    <button type="button" onClick={() => setModifiers(modifiers.map(m => m.id === mod.id ? { ...m, ingredients: [...m.ingredients, { id: Math.random().toString(), ingredientId: '', quantity: '0' }] } : m))} className="btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}><Plus size={14} /> Add Modifier Ingredient</button>
                                                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Mod Cost: <strong style={{ color: 'var(--text-primary)' }}>${modCost.toFixed(2)}</strong></span>
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })}
                                <button type="button" onClick={() => setModifiers([...modifiers, { id: Math.random().toString(), name: '', cloverModifierId: '', ingredients: [] }])} className="btn-secondary" style={{ padding: '0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', borderStyle: 'dashed' }}><Plus size={16} /> New Modifier Mapping</button>
                            </div>
                        )}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1rem' }}>
                        <button type="button" onClick={onClose} style={{ padding: '0.6rem 1.5rem', color: 'var(--text-secondary)' }}>Cancel</button>
                        <button type="submit" className="btn-primary" style={{ padding: '0.6rem 2rem', borderRadius: '8px' }}>Save Recipe</button>
                    </div>
                </form>
            </div>
        </div>
    );
}
