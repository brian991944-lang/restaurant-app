const fs = require('fs');
let code = fs.readFileSync('src/components/modals/RecipeBuilderModal.tsx', 'utf8');

// Imports
code = code.replace(
    "import { getDropdownOptions } from '@/app/actions/dropdownOptions';",
    "import { getDropdownOptions } from '@/app/actions/dropdownOptions';\nimport { SearchableSelect } from '@/components/ui/SearchableSelect';\nimport { ALLOWED_METRICS, getConversionFactor } from '@/lib/conversion';"
);

// State vars
code = code.replace(
    "    const [components, setComponents] = useState<any[]>([]);",
    "    const [components, setComponents] = useState<any[]>([]);\n    const [recipeYield, setRecipeYield] = useState<number>(1);\n    const [selectedMetric, setSelectedMetric] = useState<string>('L');"
);

// Init states
code = code.replace(
    "            if (initialData?.composedOf) {\n                setComponents(initialData.composedOf.map((c: any) => ({\n                    id: Math.random().toString(),\n                    ingredientId: c.ingredientId,\n                    quantity: c.quantity\n                })));\n            } else {\n                setComponents([]);\n            }",
    "            if (initialData?.composedOf) {\n                setRecipeYield(initialData.yieldPercent || 1);\n                setComponents(initialData.composedOf.map((c: any) => ({\n                    id: Math.random().toString(),\n                    ingredientId: c.ingredientId,\n                    quantity: c.quantity.toString(),\n                    unit: c.unit || 'units'\n                })));\n            } else {\n                setRecipeYield(1);\n                setComponents([]);\n            }\n            setSelectedMetric(initialData?.metric || 'L');"
);

// handle component change function
code = code.replace(
    "    const updateComponent = (id: string, field: string, value: any) => {\n        setComponents(components.map(c => c.id === id ? { ...c, [field]: value } : c));\n    };",
    `    const updateComponent = (id: string, field: string, value: any) => {
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
    const currentPricePreview = recipeYield > 0 ? (totalCalculatedCost / recipeYield) : 0;`
);

// fix addComponent default unit
code = code.replace(
    "setComponents([...components, { id: Math.random().toString(), ingredientId: '', quantity: 1 }]);",
    "setComponents([...components, { id: Math.random().toString(), ingredientId: '', quantity: '0', unit: 'units' }]);"
);


// Replace form elements
code = code.replace(
    `                            <select name="metric" className="input-field" defaultValue={initialData?.metric || 'L'} required>`,
    `                            <select name="metric" className="input-field" value={selectedMetric} onChange={e => setSelectedMetric(e.target.value)} required>`
);

code = code.replace(
    `                            <input name="yieldPercent" type="number" step="0.01" min="0" className="input-field" placeholder="1" defaultValue={initialData?.yieldPercent || 1} required />`,
    `                            <input name="yieldPercent" type="number" step="0.01" min="0" className="input-field" placeholder="1" value={recipeYield} onChange={(e) => setRecipeYield(parseFloat(e.target.value) || 0)} required />`
);

// Replace table
const oldTable = `                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
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
                            </div>`;

const newTable = `                                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                                    <thead>
                                        <tr style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                                            <th style={{ padding: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)' }}>{t('modal_name_placeholder')}</th>
                                            <th style={{ padding: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', width: '120px' }}>Cant (Qty)</th>
                                            <th style={{ padding: '0.75rem', fontWeight: 500, color: 'var(--text-secondary)', width: '100px' }}>Unidad</th>
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
                                                        if (!dbIng) return '$0.00';
                                                        const baseUnit = dbIng.metric || 'Units';
                                                        let lineCost = 0;
                                                        if (baseUnit.toLowerCase() === 'units' || (comp.unit || '').toLowerCase() === 'units') {
                                                            lineCost = resolveCost(dbIng) * (parseFloat(comp.quantity) || 0);
                                                        } else {
                                                            const cFactor = getConversionFactor(baseUnit, comp.unit || 'Units');
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
                                                    <button type="button" onClick={() => removeComponent(comp.id)} style={{ color: 'var(--danger)', padding: '0.4rem', border: 'none', background: 'transparent', cursor: 'pointer' }}>
                                                        <Trash2 size={16} />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>`;

code = code.replace(oldTable, newTable);

// Add Live Cost card after components
const closingDivComponents = `                        )}
                    </div>`;

const newClosingDivPlusCard = `                        )}

                            {components.length > 0 && (
                                <div style={{ marginTop: '1.5rem', padding: '1.25rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', textAlign: 'center' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Costo Total de la Receta (Total Batch Cost)</span>
                                        <span style={{ fontSize: '1.2rem', fontWeight: 600 }}>\${totalCalculatedCost.toFixed(2)}</span>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Costo por {selectedMetric} (Cost per Yield Unit)</span>
                                        <span style={{ fontSize: '1.2rem', fontWeight: 600, color: 'var(--accent-primary)' }}>\${currentPricePreview.toFixed(2)}</span>
                                    </div>
                                </div>
                            )}
                    </div>`;

code = code.replace(closingDivComponents, newClosingDivPlusCard);

code = code.replace(
    "yieldPercent: parseFloat(formData.get('yieldPercent') as string) || 1,",
    "yieldPercent: parseFloat(formData.get('yieldPercent') as string) || 1,\n            currentPrice: currentPricePreview,"
);

fs.writeFileSync('src/components/modals/RecipeBuilderModal.tsx', code);
