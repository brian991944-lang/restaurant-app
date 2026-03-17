'use client';

import { X, Plus, Trash2 } from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';
import { useState, useEffect } from 'react';
import { getDropdownOptions } from '@/app/actions/dropdownOptions';
import { getCategories, getProviders, getInventory } from '@/app/actions/inventory';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import MetricPriceSection from './MetricPriceSection';

const ALLOWED_METRICS = ['Kg', 'g', 'Lbs', 'Solid Oz', 'Fl Oz', 'ml', 'L', 'Units'];

const getConversionFactor = (parentUnit: string, childUnit: string) => {
    if (!parentUnit || !childUnit) return null;
    const p = parentUnit.toLowerCase().trim();
    const c = childUnit.toLowerCase().trim();

    if (p === 'units' && c === 'units') return 1;

    const MASS: Record<string, number> = {
        'g': 1,
        'kg': 1000,
        'lbs': 453.592, 'lb': 453.592,
        'solid oz': 28.3495, 'oz': 28.3495,
    };

    const VOL: Record<string, number> = {
        'ml': 1,
        'l': 1000,
        'fl oz': 29.5735,
    };

    if (MASS[p] && MASS[c]) return MASS[p] / MASS[c];
    if (VOL[p] && VOL[c]) return VOL[p] / VOL[c];

    return null;
};

interface AddIngredientModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: any) => void;
    initialData?: any;
}

export default function AddIngredientModal({ isOpen, onClose, onSave, initialData }: AddIngredientModalProps) {
    const t = useTranslations('Inventory');
    const tOptions = useTranslations('Options');
    const locale = useLocale();

    const [categories, setCategories] = useState<any[]>([]);
    const [providers, setProviders] = useState<any[]>([]);
    const [types, setTypes] = useState<any[]>([]);

    const [ingredients, setIngredients] = useState<any[]>([]);
    const [autoTranslate, setAutoTranslate] = useState(true);
    const [currentType, setCurrentType] = useState('RAW');
    const [currentPriceValue, setCurrentPriceValue] = useState<number>(0);
    const [nameInput, setNameInput] = useState('');
    const [nameEsInput, setNameEsInput] = useState('');
    const [translatedNamePreview, setTranslatedNamePreview] = useState('');
    const [trackFreezerStatus, setTrackFreezerStatus] = useState<boolean>(false);
    const [allowNegativeStock, setAllowNegativeStock] = useState<boolean>(false);
    const [wastePercent, setWastePercent] = useState<number>(0);
    const [isPortioned, setIsPortioned] = useState<boolean>(true);
    const [unfrozenQuantity, setUnfrozenQuantity] = useState<number>(0);
    const [recipeYield, setRecipeYield] = useState<number>(1);
    const [components, setComponents] = useState<{ id: string, ingredientId: string, quantity: string, unit: string }[]>([]);
    const [portionSize, setPortionSize] = useState<number>(1);
    const [portionUnit, setPortionUnit] = useState<string>('g');
    const [selectedMetric, setSelectedMetric] = useState<string>('Units');
    const [selectedParentId, setSelectedParentId] = useState<string>('');
    const [selectedCategory, setSelectedCategory] = useState<string>('');
    const [selectedProvider, setSelectedProvider] = useState<string>('');
    const [cloverId, setCloverId] = useState<string>('');
    const [mappingMultiplier, setMappingMultiplier] = useState<number>(1);

    useEffect(() => {
        if (!isOpen) {
            setNameInput('');
            setNameEsInput('');
            setTranslatedNamePreview('');
            setWastePercent(0);
            setCloverId('');
            setMappingMultiplier(1);
            setTrackFreezerStatus(false);
            setAllowNegativeStock(false);
            setUnfrozenQuantity(0);
        }
    }, [isOpen]);

    useEffect(() => {
        if (!autoTranslate || !nameInput) {
            setTranslatedNamePreview('');
            return;
        }
        const delayDebounceFn = setTimeout(async () => {
            try {
                const response = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=es&dt=t&q=${encodeURIComponent(nameInput)}`);
                const data = await response.json();
                if (data && data[0] && data[0][0] && data[0][0][0]) {
                    setTranslatedNamePreview(data[0][0][0]);
                }
            } catch (e) {
                console.error("Translation preview failed", e);
            }
        }, 800);

        return () => clearTimeout(delayDebounceFn);
    }, [nameInput, autoTranslate]);

    const toTitleCase = (str: string) => {
        return str.replace(
            /\w\S*/g,
            function (txt) {
                return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
            }
        );
    }

    useEffect(() => {
        if (isOpen) {
            Promise.all([
                getCategories('INGREDIENT'),
                getProviders(),
                getDropdownOptions('Type'),
                getInventory()
            ]).then(([catData, provData, typeData, invData]) => {
                setCategories(catData);
                setProviders(provData);
                setTypes(typeData);
                setIngredients(invData);
            });
            setCurrentType(initialData?.type || 'RAW');
            setCurrentPriceValue(initialData?.currentPrice || 0);
            setNameInput(initialData?.rawName || initialData?.name || '');
            if (initialData?.autoTranslate !== undefined) {
                setAutoTranslate(initialData.autoTranslate);
                setNameEsInput(initialData.nameEs || '');
            } else {
                setAutoTranslate(true);
                setNameEsInput(initialData?.nameEs || '');
            }
            if (initialData?.yieldPercent !== undefined) {
                setWastePercent(parseFloat((100 - initialData.yieldPercent).toFixed(2)));
            } else {
                setWastePercent(0);
            }

            setSelectedParentId(initialData?.parentId || '');
            setSelectedCategory(initialData?.rawCategory || initialData?.category || '');
            setSelectedProvider(initialData?.provider?.name || initialData?.providerName || '');
            setUnfrozenQuantity(initialData?.unfrozenQuantity || 0);
            setRecipeYield(initialData?.yieldPercent || 1);
            if (initialData?.composedOf) {
                setComponents(initialData.composedOf.map((c: any) => ({
                    id: Math.random().toString(),
                    ingredientId: c.ingredientId,
                    quantity: c.quantity.toString(),
                    unit: c.unit || 'units'
                })));
            } else {
                setComponents([]);
            }
            setRecipeYield(initialData?.yieldPercent || 1);
            if (initialData?.composedOf) {
                setComponents(initialData.composedOf.map((c: any) => ({
                    id: Math.random().toString(),
                    ingredientId: c.ingredientId,
                    quantity: c.quantity.toString(),
                    unit: c.unit || 'units'
                })));
            } else {
                setComponents([]);
            }

            if (initialData?.metric) {
                const match = ALLOWED_METRICS.find(m => m.toLowerCase() === initialData.metric.toLowerCase());
                setSelectedMetric(match || 'Units');
            } else {
                setSelectedMetric('Units');
            }
            if (initialData?.type === 'PROCESSED' && initialData?.metric?.toLowerCase() === 'units') {
                setIsPortioned(true);
            } else if (initialData) {
                setIsPortioned(false);
            }
            setPortionSize(initialData?.portionWeightG || 1);
            setCloverId(initialData?.cloverId || '');
            setMappingMultiplier(initialData?.mappingMultiplier ?? 1);
            setTrackFreezerStatus(initialData?.trackFreezerStatus ?? false);
            setAllowNegativeStock(initialData?.allowNegativeStock ?? false);
        }
    }, [isOpen, initialData]);

    const getOptName = (name: string, isTranslated: boolean, nameEs?: string) => {
        if (!isTranslated) {
            return (locale === 'es' && nameEs) ? nameEs : name;
        }
        try { return tOptions(name as any) || name; } catch { return name; }
    };

    let costPerPortionPreview = 0;
    let conversionError = "";
    if (currentType === 'PROCESSED' && selectedParentId) {
        const parentIng = ingredients.find(i => i.id === selectedParentId);
        if (parentIng) {
            const parentPrice = parentIng.currentPrice || 0;
            const parentMetric = parentIng.metric || 'Units';

            const targetUnit = isPortioned ? portionUnit : selectedMetric;
            const size = isPortioned ? portionSize : 1;

            const cFactor = getConversionFactor(parentMetric, targetUnit);
            if (cFactor !== null) {
                const yieldDecimal = Math.max(0.01, (100 - wastePercent) / 100);
                costPerPortionPreview = (parentPrice / cFactor) * size / yieldDecimal;
            } else {
                conversionError = `Cannot convert ${parentMetric} to ${targetUnit}`;
            }
        }
    } else if (currentType === 'PREP_RECIPE') {
        const yieldDecimal = Math.max(0.01, (100 - wastePercent) / 100);
        costPerPortionPreview = (initialData?.currentPrice || currentPriceValue || 0) / yieldDecimal;
    }

    const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);

        onSave({
            name: nameInput,
            nameEs: nameEsInput,
            categoryName: formData.get('category') as string,
            categoryNameEs: formData.get('categoryNameEs') as string,
            providerName: formData.get('provider') as string,
            type: currentType,
            metric: currentType === 'PREP_RECIPE' ? (initialData?.metric || selectedMetric) : (currentType === 'PROCESSED' && isPortioned ? 'Units' : selectedMetric),
            initialQty: parseFloat(formData.get('initialQty') as string) || 0,
            yieldPercent: parseFloat((100 - wastePercent).toFixed(2)),
            currentPrice: currentType === 'PROCESSED' ? costPerPortionPreview : (currentType === 'PREP_RECIPE' ? (initialData?.currentPrice || currentPriceValue || 0) : (parseFloat(formData.get('currentPrice') as string) || 0)),
            parentId: selectedParentId || null,
            activeMarketItemId: formData.get('activeMarketItemId') as string || null,
            autoTranslate,
            isPortioned: currentType === 'PROCESSED' ? isPortioned : false,
            portionSize: currentType === 'PROCESSED' && isPortioned ? portionSize : null,
            portionUnit: currentType === 'PROCESSED' && isPortioned ? portionUnit : null,
            cloverId: cloverId || null,
            mappingMultiplier: mappingMultiplier,
            unfrozenQuantity: currentType === 'PROCESSED' ? unfrozenQuantity : 0,
            trackFreezerStatus: trackFreezerStatus,
            allowNegativeStock: allowNegativeStock,
        });
    };

    if (!isOpen) return null;

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
            padding: '1rem'
        }}>
            <div className="glass-panel" style={{ width: '100%', maxWidth: '500px', padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem', animation: 'fadeIn 0.2s ease-out', background: 'var(--bg-primary)', maxHeight: '90vh', overflowY: 'auto' }}>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '1rem' }}>
                    <h2 style={{ fontSize: '1.5rem', margin: 0 }}>{initialData ? 'Edit Ingredient' : t('modal_add_title')}</h2>
                    <button type="button" onClick={onClose} style={{ color: 'var(--text-secondary)', padding: '0.25rem' }}><X size={20} /></button>
                </div>

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

                    {currentType === 'PREP_RECIPE' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.5rem' }}>
                            <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Recipe Name / Nombre de la Receta</label>
                            <div style={{ fontWeight: 'bold', border: '1px solid rgba(255,255,255,0.1)', padding: '12px', borderRadius: '8px', background: 'rgba(0,0,0,0.2)', color: 'var(--text-primary)', fontSize: '1.1rem' }}>
                                {nameInput}
                            </div>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{locale === 'es' ? 'Nombre en Inglés' : 'English Name'}</label>
                                <label style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer', color: 'var(--accent-primary)' }}>
                                    <input
                                        type="checkbox"
                                        checked={autoTranslate}
                                        onChange={e => setAutoTranslate(e.target.checked)}
                                        style={{ accentColor: 'var(--accent-primary)' }}
                                    />
                                    Auto-Translate Info
                                </label>
                            </div>
                            <input
                                name="name"
                                type="text"
                                className="input-field"
                                placeholder={t('modal_name_placeholder')}
                                value={nameInput}
                                onChange={(e) => setNameInput(toTitleCase(e.target.value))}
                                required
                                autoFocus
                            />

                            <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: '0.5rem' }}>Spanish Name</label>
                            <input
                                name="nameEs"
                                type="text"
                                className="input-field"
                                placeholder={autoTranslate ? "Translating..." : "Nombre en Español"}
                                value={autoTranslate ? (translatedNamePreview || (nameInput ? "Translating..." : "")) : nameEsInput}
                                onChange={(e) => setNameEsInput(e.target.value)}
                                disabled={autoTranslate}
                                required={!autoTranslate}
                            />
                        </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Product Hierarchy Level</label>
                            <select
                                className="input-field"
                                value={currentType === 'PROCESSED' ? 'Child' : (currentType === 'PREP_RECIPE' ? 'Recipe' : 'Parent')}
                                onChange={(e) => setCurrentType(e.target.value === 'Child' ? 'PROCESSED' : 'RAW')}
                                disabled={currentType === 'PREP_RECIPE'}
                            >
                                <option value="Parent">Parent Product (Standalone)</option>
                                <option value="Child">Child Product (Prepared from Parent)</option>
                                {currentType === 'PREP_RECIPE' && <option value="Recipe">Prep Recipe (Locked)</option>}
                            </select>
                        </div>
                        {currentType === 'PROCESSED' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Select Parent Ingredient</label>
                                <SearchableSelect
                                    name="parentId"
                                    value={selectedParentId}
                                    onChange={(newParentId) => {
                                        setSelectedParentId(newParentId);
                                        const parentIng = ingredients.find(i => i.id === newParentId);
                                        if (parentIng && parentIng.category?.name) {
                                            setSelectedCategory(parentIng.category.name);
                                        }
                                        if (parentIng?.type === 'PREP_RECIPE') {
                                            setSelectedMetric(parentIng.metric || 'Units');
                                        }
                                    }}
                                    options={[...ingredients].filter(i => i.type === 'RAW' || i.type === 'PREP_RECIPE').map(ing => ({ value: ing.id, label: ing.name }))}
                                    placeholder="Select Parent Ingredient..."
                                    required
                                />

                                <label style={{ fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem', cursor: 'pointer', color: 'var(--text-primary)' }}>
                                    <input
                                        type="checkbox"
                                        checked={isPortioned}
                                        onChange={e => setIsPortioned(e.target.checked)}
                                        style={{ accentColor: 'var(--accent-primary)', width: '16px', height: '16px' }}
                                    />
                                    This is a Portioned/Bagged Item
                                </label>
                            </div>
                        )}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{t('category')}</label>
                            <SearchableSelect
                                name="category"
                                value={selectedCategory}
                                onChange={setSelectedCategory}
                                options={categories.map(c => ({ value: c.name, label: c.name }))}
                                placeholder="Select Category..."
                                required
                            />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{t('modal_provider')}</label>
                            <SearchableSelect
                                name="provider"
                                value={selectedProvider}
                                onChange={setSelectedProvider}
                                options={[{ value: '', label: 'Select Provider (Optional)...' }, ...providers.map(p => ({ value: p.name, label: p.name }))]}
                                placeholder="Select Provider (Optional)..."
                            />
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{t('type')}</label>
                            <select name="type" className="input-field" value={currentType} onChange={(e) => setCurrentType(e.target.value)} required disabled={currentType === 'PREP_RECIPE'}>
                                {[...types].sort((a, b) => a.name.localeCompare(b.name)).map(tOption => <option key={tOption.id} value={tOption.name}>{getOptName(tOption.name, tOption.isTranslated, tOption.nameEs)}</option>)}
                            </select>
                        </div>
                        {currentType === 'RAW' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Current Price per Unit</label>
                                <input
                                    name="currentPrice"
                                    type="number"
                                    step="0.0001"
                                    min="0"
                                    className="input-field"
                                    placeholder="0.00"
                                    value={currentPriceValue}
                                    onChange={(e) => setCurrentPriceValue(parseFloat(e.target.value) || 0)}
                                    required
                                />
                            </div>
                        )}
                    </div>

                    <MetricPriceSection
                        currentType={currentType}
                        parentIngredient={ingredients.find(i => i.id === selectedParentId)}
                        selectedMetric={selectedMetric}
                        setSelectedMetric={setSelectedMetric}
                        ALLOWED_METRICS={ALLOWED_METRICS}
                        isPortioned={isPortioned}
                        wastePercent={wastePercent}
                        setWastePercent={setWastePercent}
                        locale={locale}
                        t={t}
                        costPerPortionPreview={costPerPortionPreview}
                        conversionError={conversionError}
                        initialData={initialData}
                    />

                    {!initialData && (
                        <div style={{ display: 'grid', gridTemplateColumns: currentType === 'PROCESSED' ? '1fr 1fr' : '1fr', gap: '1rem', flex: 1 }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{t('modal_initial_qty')} (Total Stock)</label>
                                <input name="initialQty" type="number" step="0.01" className="input-field" placeholder="0.00" required />
                            </div>
                            {currentType === 'PROCESSED' && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    <label style={{ fontSize: '0.9rem', color: 'var(--warning)' }}>How many are going to the Fridge (Unfrozen)?</label>
                                    <input
                                        name="unfrozenQuantity"
                                        type="number"
                                        step="0.01"
                                        className="input-field"
                                        value={unfrozenQuantity}
                                        onChange={(e) => setUnfrozenQuantity(parseFloat(e.target.value) || 0)}
                                    />
                                </div>
                            )}
                        </div>
                    )}

                    {currentType === 'PROCESSED' && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem', background: 'rgba(59, 130, 246, 0.05)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                                <label style={{ fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: 'var(--text-primary)' }}>
                                    <input
                                        type="checkbox"
                                        checked={trackFreezerStatus}
                                        onChange={e => setTrackFreezerStatus(e.target.checked)}
                                        style={{ accentColor: '#60a5fa', width: '16px', height: '16px' }}
                                    />
                                    <span style={{ fontWeight: 600 }}>Rastrear en Control de Congelados (Track in Freezer/Fridge)</span>
                                </label>

                                <label style={{ fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: 'var(--text-secondary)' }}>
                                    <input
                                        type="checkbox"
                                        checked={allowNegativeStock}
                                        onChange={e => setAllowNegativeStock(e.target.checked)}
                                        style={{ accentColor: 'var(--warning)', width: '16px', height: '16px' }}
                                    />
                                    <span>{locale === 'es' ? 'Permitir Stock Negativo (Ventas exceden stock)' : 'Allow Negative Stock (Sales exceed recorded stock)'}</span>
                                </label>
                            </div>

                            {trackFreezerStatus && initialData && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '1rem' }}>
                                    <label style={{ fontSize: '0.9rem', color: 'var(--warning)' }}>Cantidad Descongelada / Unfrozen in Fridge</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        className="input-field"
                                        value={unfrozenQuantity}
                                        onChange={(e) => setUnfrozenQuantity(parseFloat(e.target.value) || 0)}
                                        style={{ width: '150px' }}
                                    />
                                </div>
                            )}
                        </div>
                    )}

                    {/* MetricPriceSection handles Waste % */}

                    {currentType === 'PROCESSED' && (
                        <div style={{ display: 'grid', gridTemplateColumns: isPortioned ? '1fr 1fr 1fr' : '1fr', gap: '1rem', background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                            {isPortioned && (
                                <>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                        <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Portion Weight</label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            className="input-field"
                                            value={portionSize}
                                            onChange={e => setPortionSize(parseFloat(e.target.value) || 0)}
                                        />
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                        <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Portion Unit</label>
                                        <SearchableSelect
                                            value={portionUnit}
                                            onChange={setPortionUnit}
                                            options={ALLOWED_METRICS.filter(m => m.toLowerCase() !== 'units').map(m => ({ value: m, label: m }))}
                                        />
                                    </div>
                                </>
                            )}
                            {/* MetricPriceSection handles internal adjusted price output */}
                        </div>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{t('modal_min_alert')}</label>
                        <input name="minAlert" type="number" step="0.01" className="input-field" placeholder="0" />
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{t('modal_min_alert_helper')}</span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Clover Item ID (Optional)</label>
                            <input value={cloverId} onChange={e => setCloverId(e.target.value)} type="text" className="input-field" placeholder="e.g. WVH7N66BZZ5WT" />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Clover Sync Multiplier</label>
                            <input value={mappingMultiplier} onChange={e => setMappingMultiplier(parseFloat(e.target.value) || 1)} type="number" step="0.01" className="input-field" />
                        </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1rem' }}>
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
