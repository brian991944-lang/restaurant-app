'use client';

import React from 'react';
import { Trash2 } from 'lucide-react';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { ALLOWED_METRICS, getConversionFactor } from '@/lib/conversion';

export function ComponentRow({ comp, dbIngredients, updateComponent, removeComponent, resolveCost }: any) {
    const dbIng = dbIngredients.find((i: any) => i.id === comp.ingredientId);
    const baseUnit = dbIng ? (dbIng.metric || 'Units') : 'Units';

    let lineCostStr = '$0.00';
    if (dbIng) {
        let lineCost = 0;
        if (baseUnit.toLowerCase() === 'units' || (comp.unit || '').toLowerCase() === 'units') {
            lineCost = resolveCost(dbIng) * (parseFloat(comp.quantity) || 0);
        } else {
            const cFactor = getConversionFactor(baseUnit, comp.unit || 'Units');
            if (cFactor) {
                lineCost = (resolveCost(dbIng) / cFactor) * (parseFloat(comp.quantity) || 0);
            }
        }
        lineCostStr = '$' + lineCost.toFixed(2);
    }

    const metricOptions = baseUnit.toLowerCase() === 'units'
        ? [{ value: 'Units', label: 'Units' }]
        : ALLOWED_METRICS.filter(m => m.toLowerCase() !== 'units').map(m => ({ value: m, label: m }));

    return (
        <tr style={{ borderBottom: '1px solid var(--border)' }}>
            <td style={{ padding: '0.5rem' }}>
                <SearchableSelect
                    value={comp.ingredientId}
                    onChange={(val) => updateComponent(comp.id, 'ingredientId', val)}
                    options={dbIngredients.map((item: any) => ({ value: item.id, label: item.name }))}
                    placeholder="Select Ingredient..."
                />
            </td>
            <td style={{ padding: '0.5rem' }}>
                <input
                    type="number"
                    step="0.001"
                    min="0"
                    value={comp.quantity}
                    onChange={e => updateComponent(comp.id, 'quantity', e.target.value)}
                    className="input-field"
                    style={{ padding: '0.6rem', width: '100%' }}
                    required
                />
            </td>
            <td style={{ padding: '0.5rem' }}>
                <SearchableSelect
                    value={comp.unit}
                    onChange={val => updateComponent(comp.id, 'unit', val)}
                    options={metricOptions}
                    disabled={baseUnit.toLowerCase() === 'units'}
                />
            </td>
            <td style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 500, color: 'var(--text-primary)' }}>
                {lineCostStr}
            </td>
            <td style={{ padding: '0.5rem', textAlign: 'center' }}>
                <button type="button" onClick={() => removeComponent(comp.id)} style={{ color: 'var(--danger)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '0.5rem' }}>
                    <Trash2 size={18} />
                </button>
            </td>
        </tr>
    );
}
