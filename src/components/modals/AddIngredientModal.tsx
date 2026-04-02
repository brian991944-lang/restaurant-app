'use client';

import { X, Plus, Trash2 } from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';
import { useState, useEffect } from 'react';
import { getDropdownOptions } from '@/app/actions/dropdownOptions';
import { getCategories, getProviders, getInventory } from '@/app/actions/inventory';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { useAdmin } from '@/components/AdminContext';
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
    const { isAdmin } = useAdmin();

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
    const [totalStock, setTotalStock] = useState<string>('');
    const [unfrozenStock, setUnfrozenStock] = useState<string>('');
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

    // Packed Tracking States
    const [isPacked, setIsPacked] = useState<boolean>(false);
    const [unitsPerPack, setUnitsPerPack] = useState<number>(1);
    const [packUnit, setPackUnit] = useState<string>('Units');
    const [calcPacks, setCalcPacks] = useState<number | ''>('');
    const [calcBoxPrice, setCalcBoxPrice] = useState<number | ''>('');
    const [overrideDisplayUnit, setOverrideDisplayUnit] = useState<string>('Packs');

    const formatDisplayQty = (qty: number, unit: string) => {
        if (!unit) return qty.toString();
        if (unit === 'Packs' || unit.toLowerCase() === 'units') {
            return Math.round(qty).toString();
        }
        return Number(qty.toFixed(2)).toString();
    };

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
            setTotalStock('');
            setUnfrozenStock('');
            setIsPacked(false);
            setUnitsPerPack(1);
            setPackUnit('Units');
            setCalcPacks('');
            setCalcBoxPrice('');
            setOverrideDisplayUnit('Packs');
        }
    }, [isOpen]);

    useEffect(() => {
        if (isPacked && typeof calcBoxPrice === 'number' && typeof calcPacks === 'number' && calcBoxPrice > 0 && calcPacks > 0 && unitsPerPack > 0) {
            const basePPU = calcBoxPrice / (calcPacks * unitsPerPack);
            if (packUnit !== selectedMetric) {
                const factor = getConversionFactor(packUnit, selectedMetric);
                if (factor) {
                    setCurrentPriceValue(Number((basePPU / factor).toFixed(5)));
                    return;
                }
            }
            setCurrentPriceValue(Number(basePPU.toFixed(5)));
        }
    }, [isPacked, calcBoxPrice, calcPacks, unitsPerPack, packUnit, selectedMetric]);

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

            if (initialData?.inventory) {
                let rawTot = initialData.inventory.thawingQty + initialData.inventory.frozenQty;
                let rawUnf = initialData.inventory.thawingQty;
                if (initialData.isPacked) {
                    setOverrideDisplayUnit('Packs');
                    const multiplier = initialData.unitsPerPack || 1;
                    if (initialData.metric && initialData.packUnit && initialData.metric.toLowerCase() !== initialData.packUnit.toLowerCase()) {
                        const factor = getConversionFactor(initialData.packUnit, initialData.metric);
                        if (factor) {
                            rawTot = rawTot / factor;
                            rawUnf = rawUnf / factor;
                        }
                    }
                    setTotalStock(formatDisplayQty(rawTot / multiplier, 'Packs'));
                    setUnfrozenStock(formatDisplayQty(rawUnf / multiplier, 'Packs'));
                } else {
                    const tUnit = initialData.metric || 'Units';
                    setOverrideDisplayUnit(tUnit);
                    setTotalStock(formatDisplayQty(rawTot, tUnit));
                    setUnfrozenStock(formatDisplayQty(rawUnf, tUnit));
                }
            } else {
                setTotalStock('');
                setUnfrozenStock('');
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
            setIsPacked(initialData?.isPacked ?? false);
            setUnitsPerPack(initialData?.unitsPerPack ?? 1.0);
            setPackUnit(initialData?.packUnit ?? 'Units');
            setCalcPacks(initialData?.packsInBox || '');
            setCalcBoxPrice(initialData?.totalBoxPrice || '');
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

    const isDescongeladoInvalid = trackFreezerStatus
        && unfrozenStock !== ''
        && totalStock !== ''
        && parseFloat(unfrozenStock) > parseFloat(totalStock);

    const handleOverrideDisplayUnitChange = (newUnit: string) => {
        if (!isPacked) return; // Restricted logic to Packed configurations only
        if (totalStock === '') {
            setOverrideDisplayUnit(newUnit);
            return;
        }

        let qty = parseFloat(totalStock);
        let sourceMetric = overrideDisplayUnit === 'Packs' ? packUnit : overrideDisplayUnit;
        let targetMetric = newUnit === 'Packs' ? packUnit : newUnit;

        // Translate base stock
        let qtyInSource = overrideDisplayUnit === 'Packs' ? qty * unitsPerPack : qty;
        if (sourceMetric.toLowerCase() !== targetMetric.toLowerCase()) {
            const factor = getConversionFactor(sourceMetric, targetMetric);
            if (factor) qtyInSource = qtyInSource * factor;
        }
        let finalQty = newUnit === 'Packs' ? qtyInSource / unitsPerPack : qtyInSource;
        setTotalStock(formatDisplayQty(finalQty, newUnit));

        // Translate thawing stock
        if (unfrozenStock !== '') {
            let uQty = parseFloat(unfrozenStock);
            let uInSource = overrideDisplayUnit === 'Packs' ? uQty * unitsPerPack : uQty;
            if (sourceMetric.toLowerCase() !== targetMetric.toLowerCase()) {
                const uFactor = getConversionFactor(sourceMetric, targetMetric);
                if (uFactor) uInSource = uInSource * uFactor;
            }
            let uFinalQty = newUnit === 'Packs' ? uInSource / unitsPerPack : uInSource;
            setUnfrozenStock(formatDisplayQty(uFinalQty, newUnit));
        }

        setOverrideDisplayUnit(newUnit);
    };

    const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        if (isDescongeladoInvalid) return;

        const formData = new FormData(e.currentTarget);

        const getFinalQuantity = (rawQty: string) => {
            if (rawQty === '') return undefined;
            let qty = parseFloat(rawQty);
            if (isPacked) {
                let sourceUnit = overrideDisplayUnit === 'Packs' ? packUnit : overrideDisplayUnit;
                let qtyInSource = overrideDisplayUnit === 'Packs' ? qty * unitsPerPack : qty;
                if (sourceUnit.toLowerCase() !== selectedMetric.toLowerCase()) {
                    const factor = getConversionFactor(sourceUnit, selectedMetric);
                    if (factor) qtyInSource = qtyInSource * factor;
                }
                return qtyInSource;
            } else {
                return qty;
            }
        };

        onSave({
            name: nameInput,
            nameEs: nameEsInput,
            categoryName: formData.get('category') as string,
            categoryNameEs: formData.get('categoryNameEs') as string,
            providerName: formData.get('provider') as string,
            type: currentType,
            metric: currentType === 'PREP_RECIPE' ? (initialData?.metric || selectedMetric) : (currentType === 'PROCESSED' && isPortioned ? 'Units' : selectedMetric),
            initialQty: getFinalQuantity(totalStock),
            yieldPercent: parseFloat((100 - wastePercent).toFixed(2)),
            currentPrice: currentType === 'PROCESSED' ? costPerPortionPreview : (currentType === 'PREP_RECIPE' ? (initialData?.currentPrice || currentPriceValue || 0) : currentPriceValue),
            parentId: selectedParentId || null,
            activeMarketItemId: formData.get('activeMarketItemId') as string || null,
            autoTranslate,
            isPortioned: currentType === 'PROCESSED' ? isPortioned : false,
            portionSize: currentType === 'PROCESSED' && isPortioned ? portionSize : null,
            portionUnit: currentType === 'PROCESSED' && isPortioned ? portionUnit : null,
            cloverId: cloverId || null,
            mappingMultiplier: mappingMultiplier,
            unfrozenQuantity: trackFreezerStatus ? getFinalQuantity(unfrozenStock) : undefined,
            trackFreezerStatus: trackFreezerStatus,
            allowNegativeStock: allowNegativeStock,
            isPacked: isPacked,
            unitsPerPack: isPacked ? unitsPerPack : 1.0,
            packUnit: isPacked ? packUnit : 'Units',
            packsInBox: isPacked && typeof calcPacks === 'number' ? calcPacks : null,
            totalBoxPrice: isPacked && typeof calcBoxPrice === 'number' ? calcBoxPrice : null,
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

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '1rem' }}>
                    <h2 style={{ fontSize: '1.5rem', margin: 0 }}>{initialData ? 'Edit Ingredient' : t('modal_add_title')}</h2>
                    <button type="button" onClick={onClose} style={{ color: 'var(--text-secondary)', padding: '0.25rem' }}><X size={20} /></button>
                </div>

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

                    {currentType === 'PREP_RECIPE' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.5rem' }}>
                            <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Recipe Name / Nombre de la Receta</label>
                            <div style={{ fontWeight: 'bold', border: '1px solid var(--border)', padding: '12px', borderRadius: '8px', background: 'rgba(0,0,0,0.2)', color: 'var(--text-primary)', fontSize: '1.1rem' }}>
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
                                    disabled={isPacked}
                                    style={isPacked ? { opacity: 0.6, cursor: 'not-allowed', background: 'rgba(255,255,255,0.05)' } : {}}
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
                        isPacked={isPacked}
                        wastePercent={wastePercent}
                        setWastePercent={setWastePercent}
                        locale={locale}
                        t={t}
                        costPerPortionPreview={costPerPortionPreview}
                        conversionError={conversionError}
                        initialData={initialData}
                    />

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', border: '1px solid var(--border)' }}>
                        <label style={{ fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: 'var(--text-primary)', fontWeight: 600 }}>
                            <input
                                type="checkbox"
                                checked={isPacked}
                                onChange={e => setIsPacked(e.target.checked)}
                                style={{ accentColor: 'var(--accent-primary)', width: '18px', height: '18px' }}
                            />
                            Is Packed/Bagged Item?
                        </label>
                        {isPacked && (
                            <>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                        <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Weight/Units per Pack</label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            className="input-field"
                                            value={unitsPerPack}
                                            onChange={(e) => setUnitsPerPack(parseFloat(e.target.value) || 0)}
                                            required={isPacked}
                                        />
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                        <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Unit of Measurement</label>
                                        <select
                                            className="input-field"
                                            value={packUnit}
                                            onChange={(e) => setPackUnit(e.target.value)}
                                            required={isPacked}
                                        >
                                            {ALLOWED_METRICS.map(m => {
                                                let translated = m;
                                                try {
                                                    const tStr = tOptions(m as any);
                                                    if (tStr && !tStr.includes('Options.')) translated = tStr;
                                                } catch { }
                                                return <option key={m} value={m}>{translated}</option>;
                                            })}
                                        </select>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem', borderTop: '1px dashed rgba(255,255,255,0.1)', paddingTop: '1rem' }}>
                                    <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Invoice Calculator (Optional)</label>
                                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '-0.3rem' }}>Calculate unit price automatically from the supplier invoice.</span>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '0.5rem' }}>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                            <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Packs/Bags in Box</label>
                                            <input
                                                type="number"
                                                step="1"
                                                min="1"
                                                id="calcPacksPerBox"
                                                className="input-field"
                                                placeholder="e.g. 6"
                                                value={calcPacks === '' ? '' : calcPacks}
                                                onChange={(e) => {
                                                    const packs = e.target.value === '' ? '' : (parseFloat(e.target.value) || 0);
                                                    setCalcPacks(packs);
                                                }}
                                            />
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                            <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Total Box Price ($)</label>
                                            <input
                                                type="number"
                                                step="0.01"
                                                min="0"
                                                id="calcBoxPrice"
                                                className="input-field"
                                                placeholder="e.g. 120.00"
                                                value={calcBoxPrice === '' ? '' : calcBoxPrice}
                                                onChange={(e) => {
                                                    const price = e.target.value === '' ? '' : (parseFloat(e.target.value) || 0);
                                                    setCalcBoxPrice(price);
                                                }}
                                            />
                                        </div>
                                    </div>
                                    {unitsPerPack > 0 && currentPriceValue > 0 && typeof calcBoxPrice === 'number' && calcBoxPrice > 0 && (
                                        <div style={{ fontSize: '0.85rem', color: 'var(--success)', marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                            ✓ Base Price securely calculated to <strong>${currentPriceValue}</strong> per {selectedMetric}
                                        </div>
                                    )}
                                </div>
                            </>
                        )}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: currentType === 'PROCESSED' ? '1fr 1fr' : '1fr', gap: '1rem', flex: 1 }}>
                        {(!initialData || isAdmin) && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '-0.2rem' }}>
                                    <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                        {!initialData ? `Admin Override (Total Stock)` : `Admin Override (Total Stock)`}
                                    </label>
                                    {isPacked && (
                                        <select
                                            className="input-field"
                                            style={{ width: 'auto', padding: '0.2rem 2rem 0.2rem 0.5rem', fontSize: '0.8rem', height: '28px', backgroundColor: 'var(--bg-tertiary)', border: 'none', color: 'var(--text-primary)', borderRadius: '4px' }}
                                            value={overrideDisplayUnit}
                                            onChange={(e) => handleOverrideDisplayUnitChange(e.target.value)}
                                        >
                                            <option value="Packs">Packs/Bags</option>
                                            {ALLOWED_METRICS.map(m => (
                                                <option key={m} value={m}>{m}</option>
                                            ))}
                                        </select>
                                    )}
                                </div>
                                <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                    {initialData?.inventory && (
                                        <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--accent-primary)', marginTop: '0.2rem', fontWeight: 600 }}>
                                            Current DB Total: {(() => {
                                                if (!initialData.isPacked) return Number((initialData.inventory.thawingQty + initialData.inventory.frozenQty).toFixed(4)) + " " + (initialData.metric || 'Units');
                                                let amt = initialData.inventory.thawingQty + initialData.inventory.frozenQty; // amt is in Metric
                                                let targetUnit = overrideDisplayUnit === 'Packs' ? (initialData.packUnit || 'Units') : overrideDisplayUnit;
                                                if (initialData.metric && targetUnit && initialData.metric.toLowerCase() !== targetUnit.toLowerCase()) {
                                                    const factor = getConversionFactor(initialData.metric, targetUnit);
                                                    if (factor) amt = amt * factor;
                                                }
                                                if (overrideDisplayUnit === 'Packs') {
                                                    amt = amt / (initialData.unitsPerPack || 1);
                                                }
                                                return formatDisplayQty(amt, overrideDisplayUnit) + " " + (overrideDisplayUnit === 'Packs' ? 'Packs' : overrideDisplayUnit);
                                            })()}
                                        </span>
                                    )}
                                </label>
                                <input
                                    name="initialQty"
                                    type="number"
                                    step={overrideDisplayUnit === 'Packs' || overrideDisplayUnit.toLowerCase() === 'units' ? "1" : "0.01"}
                                    className="input-field"
                                    value={totalStock}
                                    onChange={(e) => setTotalStock(e.target.value)}
                                    placeholder="0.00"
                                    required={!initialData}
                                />
                            </div>
                        )}
                        {!initialData && (currentType === 'PROCESSED' || currentType === 'PREP_RECIPE') && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                <label style={{ fontSize: '0.9rem', color: 'var(--warning)' }}>How many are going to the Fridge (Unfrozen)?</label>
                                <input
                                    name="unfrozenQuantity"
                                    type="number"
                                    step={overrideDisplayUnit === 'Packs' || overrideDisplayUnit.toLowerCase() === 'units' ? "1" : "0.01"}
                                    className="input-field"
                                    value={unfrozenStock}
                                    onChange={(e) => {
                                        setUnfrozenStock(e.target.value);
                                        // Auto calculate total if new item
                                        if (!initialData && e.target.value !== '' && totalStock === '') {
                                            setTotalStock(e.target.value);
                                        }
                                    }}
                                />
                            </div>
                        )}
                    </div>

                    {(currentType === 'PROCESSED' || currentType === 'PREP_RECIPE') && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem', background: 'rgba(59, 130, 246, 0.05)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
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
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
                                    <label style={{ fontSize: '0.9rem', color: 'var(--warning)' }}>
                                        Cantidad Descongelada / Unfrozen in Fridge
                                        <span style={{ display: 'block', fontSize: '0.8rem', color: isDescongeladoInvalid ? 'var(--danger)' : 'var(--warning)', marginTop: '0.2rem', fontWeight: 600 }}>
                                            {isDescongeladoInvalid ? 'Error: Descongelado cannot exceed Total Stock.' : `Current DB Unfrozen: ${initialData.inventory?.thawingQty !== undefined ? initialData.inventory.thawingQty : 0} ${initialData.metric || 'Units'}`}
                                        </span>
                                    </label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        className="input-field"
                                        value={unfrozenStock}
                                        onChange={(e) => {
                                            setUnfrozenStock(e.target.value);
                                        }}
                                        style={{ width: '150px', border: isDescongeladoInvalid ? '2px solid var(--danger)' : undefined, background: isDescongeladoInvalid ? 'rgba(239, 68, 68, 0.1)' : undefined }}
                                    />
                                </div>
                            )}
                        </div>
                    )}

                    {/* MetricPriceSection handles Waste % */}

                    {currentType === 'PROCESSED' && (
                        <div style={{ display: 'grid', gridTemplateColumns: isPortioned ? '1fr 1fr 1fr' : '1fr', gap: '1rem', background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
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

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
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
                        <button type="submit" className="btn-primary" style={{ padding: '0.6rem 1.5rem', borderRadius: '8px', opacity: isDescongeladoInvalid ? 0.5 : 1 }} disabled={isDescongeladoInvalid}>
                            {t('modal_save')}
                        </button>
                    </div>
                </form>
            </div >
        </div >
    );
}
