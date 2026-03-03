const fs = require('fs');
let code = fs.readFileSync('src/components/modals/AddIngredientModal.tsx', 'utf8');

code = code.replace("import { X } from 'lucide-react';", "import { X, Plus, Trash2 } from 'lucide-react';");

code = code.replace(
    "    const [unfrozenQuantity, setUnfrozenQuantity] = useState<number>(0);",
    "    const [unfrozenQuantity, setUnfrozenQuantity] = useState<number>(0);\n    const [recipeYield, setRecipeYield] = useState<number>(1);\n    const [components, setComponents] = useState<{ id: string, ingredientId: string, quantity: string, unit: string }[]>([]);"
);

code = code.replace(
    "            setUnfrozenQuantity(0);\n        }",
    "            setUnfrozenQuantity(0);\n            setRecipeYield(1);\n            setComponents([]);\n        }"
);

code = code.replace(
    "            setUnfrozenQuantity(initialData?.unfrozenQuantity || 0);",
    "            setUnfrozenQuantity(initialData?.unfrozenQuantity || 0);\n            setRecipeYield(initialData?.yieldPercent || 1);\n            if (initialData?.composedOf) {\n                setComponents(initialData.composedOf.map((c: any) => ({\n                    id: Math.random().toString(),\n                    ingredientId: c.ingredientId,\n                    quantity: c.quantity.toString(),\n                    unit: c.unit || 'units'\n                })));\n            } else {\n                setComponents([]);\n            }"
);

// We need to replace the cost per portion calculate and handler
let oldCostCalc = `    let costPerPortionPreview = 0;
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
                conversionError = \`Cannot convert \${parentMetric} to \${targetUnit}\`;
            }
        }
    }`;

let newCostCalc = `    const handleAddComponent = () => {
        setComponents([...components, { id: Math.random().toString(), ingredientId: '', quantity: '0', unit: 'units' }]);
    };

    const handleRemoveComponent = (id: string) => {
        setComponents(components.filter(c => c.id !== id));
    };

    const handleComponentChange = (id: string, field: string, value: string) => {
        if (field === 'ingredientId') {
            const selectedItem = ingredients.find(i => i.id === value);
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
            const dbIng = ingredients.find(i => i.id === comp.ingredientId);
            if (!dbIng) return acc;
            const baseUnit = dbIng.metric || 'Units';
            let lineCost = 0;
            if (baseUnit.toLowerCase() === 'units' || comp.unit.toLowerCase() === 'units') {
                lineCost = resolveCost(dbIng) * (parseFloat(comp.quantity) || 0);
            } else {
                const cFactor = getConversionFactor(baseUnit, comp.unit);
                if (cFactor) {
                    const costPerTargetUnit = resolveCost(dbIng) / cFactor;
                    lineCost = costPerTargetUnit * (parseFloat(comp.quantity) || 0);
                }
            }
            return acc + lineCost;
        }, 0);
    };

    const totalCalculatedCost = calculateTotalCost();
    const currentPricePreview = recipeYield > 0 ? (totalCalculatedCost / recipeYield) : 0;`;

code = code.replace(oldCostCalc, newCostCalc);

// Replace the handle submit payload
let oldSubmit = `            metric: currentType === 'PROCESSED' && isPortioned ? 'Units' : selectedMetric,
            initialQty: parseFloat(formData.get('initialQty') as string) || 0,
            yieldPercent: parseFloat((100 - wastePercent).toFixed(2)),
            currentPrice: currentType === 'PROCESSED' ? costPerPortionPreview : (parseFloat(formData.get('currentPrice') as string) || 0),
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
            allowNegativeStock: allowNegativeStock,`;

let newSubmit = `            metric: selectedMetric,
            initialQty: parseFloat(formData.get('initialQty') as string) || 0,
            yieldPercent: currentType === 'PROCESSED' ? recipeYield : 100,
            currentPrice: currentType === 'PROCESSED' ? currentPricePreview : (parseFloat(formData.get('currentPrice') as string) || 0),
            parentId: null,
            activeMarketItemId: formData.get('activeMarketItemId') as string || null,
            autoTranslate,
            isPortioned: false,
            portionSize: null,
            portionUnit: null,
            cloverId: cloverId || null,
            mappingMultiplier: mappingMultiplier,
            unfrozenQuantity: currentType === 'PROCESSED' ? unfrozenQuantity : 0,
            trackFreezerStatus: trackFreezerStatus,
            allowNegativeStock: allowNegativeStock,
            components: currentType === 'PROCESSED' ? components.filter(c => c.ingredientId && parseFloat(c.quantity) > 0) : undefined,`;

code = code.replace(oldSubmit, newSubmit);

// Erase the Parent selector and isPortioned block
let parentBlock = `{currentType === 'PROCESSED' && (
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
                                    }}
                                    options={[...ingredients].filter(i => i.type === 'RAW').map(ing => ({ value: ing.id, label: ing.name }))}
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
                        )}`;
code = code.replace(parentBlock, "");

// Replace metric selector
let metricBlock = `                            <SearchableSelect
                                name="metric"
                                value={selectedMetric}
                                onChange={setSelectedMetric}
                                options={ALLOWED_METRICS.filter(m => (currentType === 'PROCESSED' && isPortioned) ? m.toLowerCase() === 'units' : m.toLowerCase() !== 'units').map(m => ({ value: m, label: m }))}
                                disabled={currentType === 'PROCESSED' && isPortioned}
                            />`;
let newMetricBlock = `                            <SearchableSelect
                                name="metric"
                                value={selectedMetric}
                                onChange={setSelectedMetric}
                                options={ALLOWED_METRICS.map(m => ({ value: m, label: m }))}
                            />`;
code = code.replace(metricBlock, newMetricBlock);


// Replace old PROCESSED Waste layout and Portioned layout
let wasteLayout1 = `{currentType === 'PROCESSED' && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{locale === 'es' ? 'Merma %' : 'Waste %'}</label>
                                <input
                                    name="wastePercent"
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    max="100"
                                    className="input-field"
                                    placeholder="0"
                                    value={wastePercent}
                                    onChange={(e) => setWastePercent(parseFloat(e.target.value) || 0)}
                                    required
                                />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{t('modal_yield')}</label>
                                <input
                                    name="yieldPercent"
                                    type="number"
                                    className="input-field"
                                    value={(100 - wastePercent).toFixed(2)}
                                    disabled
                                    style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)', opacity: 0.8 }}
                                />
                            </div>
                        </div>
                    )}`;
let wasteLayout2 = `{currentType === 'PROCESSED' && (
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
                                            options={ALLOWED_METRICS.map(m => ({ value: m, label: m }))}
                                        />
                                    </div>
                                </>
                            )}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Cost Per Target Unit (Preview)</label>
                                <input
                                    type="text"
                                    className="input-field"
                                    value={\`$\${costPerPortionPreview.toFixed(2)} \${isPortioned ? \`/ \${portionSize}\${portionUnit}\` : \` / \${selectedMetric}\`}\`}
                                    disabled
                                    style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--accent-primary)', fontWeight: 'bold' }}
                                />
                                {conversionError && <span style={{ color: 'var(--danger)', fontSize: '0.8rem' }}>{conversionError}</span>}
                            </div>
                        </div>
                    )}`;
code = code.replace(wasteLayout1, "");
let recipeBuilderLayout = `{currentType === 'PROCESSED' && (
                        <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '1.5rem', marginTop: '1rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                <h3 style={{ fontSize: '1.1rem', margin: 0 }}>Recipe Builder (Componentes)</h3>
                                <button type="button" onClick={handleAddComponent} className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}>
                                    <Plus size={14} /> Add Ingredient
                                </button>
                            </div>

                            {components.length === 0 ? (
                                <div style={{ padding: '2rem', textAlign: 'center', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', color: 'var(--text-secondary)' }}>
                                    No ingredients added yet. Build your recipe!
                                </div>
                            ) : (
                                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                                    <thead>
                                        <tr style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                                            <th style={{ padding: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)' }}>{locale === 'es' ? 'Ingrediente' : 'Ingredient'}</th>
                                            <th style={{ padding: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', width: '120px' }}>{locale === 'es' ? 'Cant (Qty)' : 'Qty (e.g 0.25)'}</th>
                                            <th style={{ padding: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', width: '100px' }}>{locale === 'es' ? 'Unidad' : 'Metric'}</th>
                                            <th style={{ padding: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', width: '90px', textAlign: 'right' }}>{locale === 'es' ? 'Costo' : 'Cost'}</th>
                                            <th style={{ padding: '0.75rem', width: '50px' }}></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {components.map((comp) => (
                                            <tr key={comp.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                                <td style={{ padding: '0.5rem' }}>
                                                    <SearchableSelect
                                                        value={comp.ingredientId}
                                                        onChange={(val) => handleComponentChange(comp.id, 'ingredientId', val)}
                                                        options={ingredients.filter(i => i.id !== initialData?.id).map(item => ({ value: item.id, label: item.name }))}
                                                        placeholder="Select..."
                                                    />
                                                </td>
                                                <td style={{ padding: '0.5rem' }}>
                                                    <input
                                                        type="number"
                                                        step="0.001"
                                                        value={comp.quantity}
                                                        onChange={e => handleComponentChange(comp.id, 'quantity', e.target.value)}
                                                        className="input-field"
                                                        style={{ padding: '0.6rem' }}
                                                        required
                                                    />
                                                </td>
                                                <td style={{ padding: '0.5rem' }}>
                                                    {(() => {
                                                        const dbIng = ingredients.find(i => i.id === comp.ingredientId);
                                                        const baseUnit = dbIng ? (dbIng.metric || 'Units') : 'Units';

                                                        const options = baseUnit.toLowerCase() === 'units'
                                                            ? [{ value: 'Units', label: 'Units' }]
                                                            : ALLOWED_METRICS.filter(m => m.toLowerCase() !== 'units').map(m => ({ value: m, label: m }));

                                                        return (
                                                            <SearchableSelect
                                                                value={comp.unit}
                                                                onChange={val => handleComponentChange(comp.id, 'unit', val)}
                                                                options={options}
                                                                disabled={baseUnit.toLowerCase() === 'units'}
                                                            />
                                                        );
                                                    })()}
                                                </td>
                                                <td style={{ padding: '0.5rem', textAlign: 'right' }}>
                                                    {(() => {
                                                        const dbIng = ingredients.find(i => i.id === comp.ingredientId);
                                                        if (!dbIng) return '$0.00';
                                                        const baseUnit = dbIng.metric || 'Units';
                                                        let lineCost = 0;
                                                        if (baseUnit.toLowerCase() === 'units' || comp.unit.toLowerCase() === 'units') {
                                                            lineCost = resolveCost(dbIng) * (parseFloat(comp.quantity) || 0);
                                                        } else {
                                                            const cFactor = getConversionFactor(baseUnit, comp.unit);
                                                            if (cFactor) {
                                                                lineCost = (resolveCost(dbIng) / cFactor) * (parseFloat(comp.quantity) || 0);
                                                            } else {
                                                                return <span style={{ color: 'var(--warning)', fontSize: '0.8rem' }}>Err</span>;
                                                            }
                                                        }
                                                        return '$' + lineCost.toFixed(2);
                                                    })()}
                                                </td>
                                                <td style={{ padding: '0.5rem', textAlign: 'center' }}>
                                                    <button type="button" onClick={() => handleRemoveComponent(comp.id)} style={{ color: 'var(--danger)', padding: '0.4rem', border: 'none', background: 'transparent', cursor: 'pointer' }}>
                                                        <Trash2 size={16} />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                            
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem', marginTop: '1rem' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{locale === 'es' ? 'Rendimiento de la Receta (Yield)' : 'Recipe Yield (Batch Size)'}</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        min="0.01"
                                        className="input-field"
                                        placeholder="e.g. 4"
                                        value={recipeYield}
                                        onChange={(e) => setRecipeYield(parseFloat(e.target.value) || 1)}
                                        required
                                    />
                                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>This batch makes {recipeYield} {selectedMetric}</span>
                                </div>
                            </div>
                            
                            {components.length > 0 && (
                                <div style={{ marginTop: '1.5rem', padding: '1.25rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', textAlign: 'center' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Total Batch Cost</span>
                                        <span style={{ fontSize: '1.2rem', fontWeight: 600 }}>\${totalCalculatedCost.toFixed(2)}</span>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Cost per {selectedMetric}</span>
                                        <span style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--accent-primary)' }}>\${currentPricePreview.toFixed(2)}</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}`;
code = code.replace(wasteLayout2, recipeBuilderLayout);


fs.writeFileSync('src/components/modals/AddIngredientModal.tsx', code);
