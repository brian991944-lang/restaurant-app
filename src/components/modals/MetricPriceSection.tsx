import React from 'react';
import { SearchableSelect } from '@/components/ui/SearchableSelect';

interface MetricPriceSectionProps {
    currentType: string;
    parentIngredient: any;
    selectedMetric: string;
    setSelectedMetric: (val: string) => void;
    ALLOWED_METRICS: string[];
    isPortioned: boolean;
    wastePercent: number;
    setWastePercent: (val: number) => void;
    locale: string;
    t: any;
    costPerPortionPreview: number;
    conversionError: string | null;
}

export default function MetricPriceSection({
    currentType,
    parentIngredient,
    selectedMetric,
    setSelectedMetric,
    ALLOWED_METRICS,
    isPortioned,
    wastePercent,
    setWastePercent,
    locale,
    t,
    costPerPortionPreview,
    conversionError
}: MetricPriceSectionProps) {

    const isRecipeChild = currentType === 'PROCESSED' && parentIngredient?.type === 'PREP_RECIPE';

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', width: '100%', padding: '1.5rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)', background: 'rgba(0,0,0,0.15)' }}>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', flex: 1 }}>
                <label style={{ fontSize: '0.95rem', color: 'var(--text-secondary)', fontWeight: 600 }}>{t('metric')} / {locale === 'es' ? 'Unidad Base' : 'Base Unit'}</label>
                {isRecipeChild ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', background: '#333', padding: '0.8rem', borderRadius: '8px' }}>
                        <span style={{ fontWeight: 'bold', border: '1px solid #ccc', padding: '8px 16px', borderRadius: '6px', backgroundColor: '#eee', color: '#111', fontSize: '1rem', minWidth: '80px', textAlign: 'center' }}>
                            {parentIngredient?.metric || selectedMetric}
                        </span>
                        <div style={{ fontSize: '1.3rem', fontWeight: 600, color: '#007bff', display: 'flex', flexDirection: 'column' }}>
                            ${(parentIngredient?.currentPrice || 0).toFixed(4)}
                            <span style={{ fontSize: '0.75rem', color: '#aaa', fontWeight: 400, marginTop: '2px' }}>Base Unit Price from Recipe</span>
                        </div>
                    </div>
                ) : (
                    <SearchableSelect
                        name="metric"
                        value={selectedMetric}
                        onChange={setSelectedMetric}
                        options={ALLOWED_METRICS.filter(m => (currentType === 'PROCESSED' && isPortioned) ? m.toLowerCase() === 'units' : m.toLowerCase() !== 'units').map(m => ({ value: m, label: m }))}
                        disabled={currentType === 'PROCESSED' && isPortioned}
                    />
                )}
            </div>

            {currentType === 'PROCESSED' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '1.2rem', marginTop: '0.5rem' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                            <label style={{ fontSize: '0.95rem', color: 'var(--text-primary)', fontWeight: 'bold' }}>{locale === 'es' ? 'Merma %' : 'Waste %'}</label>
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
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                            <label style={{ fontSize: '0.95rem', color: 'var(--text-secondary)' }}>
                                {locale === 'es' ? 'Rendimiento %' : 'Usage %'}
                            </label>
                            <input
                                name="yieldPercent"
                                type="number"
                                className="input-field"
                                value={(100 - wastePercent).toFixed(2)}
                                disabled
                                style={{ background: 'rgba(255,255,255,0.02)', color: 'var(--text-secondary)', opacity: 0.8 }}
                            />
                        </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', marginTop: '0.5rem', background: 'rgba(0,123,255,0.1)', padding: '1rem', borderRadius: '8px', borderLeft: '4px solid #007bff' }}>
                        <span style={{ fontSize: '0.85rem', color: '#007bff', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                            {locale === 'es' ? 'Precio Ajustado por Merma' : 'Adjusted Price'}
                        </span>

                        {conversionError ? (
                            <span style={{ color: 'var(--warning)', fontSize: '0.85rem' }}>{conversionError}</span>
                        ) : (
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem' }}>
                                <span style={{ fontSize: '1.8rem', fontWeight: 800, color: '#007bff' }}>
                                    ${costPerPortionPreview.toFixed(4)}
                                </span>
                                <span style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.7)', fontWeight: 500 }}>
                                    per {isPortioned ? 'portion' : selectedMetric}
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
