'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { DatePicker } from '@/components/ui/DatePicker';
import { getRecibirData, markReceived, registerPurchase, type CreditedLine } from '@/app/actions/purchases';
import { isWeightMetric, packSize, unitLabel } from '@/lib/purchaseUnits';

// Admin "Recibir" tab: posts what was actually bought to raw stock.
// Prefills one row per active RAW marked COMPRADO; anything else is added with
// the picker. Packed items: qty is always packs. No backdrop-filter / transform
// / filter on anything here (iPad Safari rendering).

interface RecibirIngredient {
    id: string;
    name: string;
    metric: string;
    isPacked: boolean;
    unitsPerPack: number;
    packUnit: string;
    purchaseStatus: string;
    providerId: string | null;
    provider: { name: string } | null;
    inventory: { frozenQty: number; thawingQty: number } | null;
}

interface Row {
    ingredientId: string;
    qty: string;
    unit: string;
    weight: string;
    price: string;
}

const OTHER = '__OTHER__';

function todayYMD(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmt(n: number): string {
    return Number(n.toFixed(2)).toString();
}

const inputStyle: React.CSSProperties = {
    minHeight: '44px', padding: '0.5rem 0.75rem', borderRadius: '8px',
    border: '1px solid var(--border)', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '1rem',
};

const labelStyle: React.CSSProperties = { fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.25rem' };

export default function RecibirTab({ locale }: { locale: 'es' | 'en' }) {
    const t = useTranslations('Recibir');
    const [ingredients, setIngredients] = useState<RecibirIngredient[]>([]);
    const [providers, setProviders] = useState<{ id: string; name: string }[]>([]);
    const [rows, setRows] = useState<Row[]>([]);
    const [providerChoice, setProviderChoice] = useState('');
    const [otherName, setOtherName] = useState('');
    const [date, setDate] = useState(todayYMD());
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [confirmed, setConfirmed] = useState<CreditedLine[] | null>(null);

    const byId = useMemo(() => new Map(ingredients.map(i => [i.id, i])), [ingredients]);

    const defaultUnit = (ing: RecibirIngredient) => (ing.isPacked ? t('packUnit') : unitLabel(ing.metric, locale));
    const newRow = (ing: RecibirIngredient): Row => ({ ingredientId: ing.id, qty: '', unit: defaultUnit(ing), weight: '', price: '' });

    const load = async () => {
        setIsLoading(true);
        const res = await getRecibirData();
        if (res.success) {
            const list = res.ingredients as RecibirIngredient[];
            setIngredients(list);
            setProviders(res.providers);
            setRows(list.filter(i => i.purchaseStatus === 'COMPRADO').map(newRow));
        } else {
            setError(res.error ?? null);
        }
        setIsLoading(false);
    };

    useEffect(() => { load(); }, []);

    const updateRow = (idx: number, patch: Partial<Row>) =>
        setRows(prev => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

    const pickerResults = useMemo(() => {
        const inRows = new Set(rows.map(r => r.ingredientId));
        const q = search.trim().toLowerCase();
        return ingredients.filter(i => !inRows.has(i.id) && (!q || i.name.toLowerCase().includes(q))).slice(0, 30);
    }, [ingredients, rows, search]);

    const handleSave = async () => {
        setError(null);
        setConfirmed(null);
        const filled = rows.filter(r => parseFloat(r.qty) > 0);
        if (filled.length === 0) { setError(t('noLines')); return; }

        const provider = providers.find(p => p.id === providerChoice);
        setIsSaving(true);
        const res = await registerPurchase({
            providerId: provider?.id ?? null,
            supplierName: providerChoice === OTHER ? otherName.trim() || null : provider?.name ?? null,
            purchasedAt: new Date(`${date}T12:00:00`).toISOString(),
            source: 'MANUAL',
            lines: filled.map(r => ({
                ingredientId: r.ingredientId,
                qty: parseFloat(r.qty),
                unit: r.unit,
                totalWeightLb: parseFloat(r.weight) > 0 ? parseFloat(r.weight) : null,
                priceCents: parseFloat(r.price) > 0 ? Math.round(parseFloat(r.price) * 100) : null,
            })),
        });

        if (res.ok) {
            await markReceived(res.lines.map(l => l.ingredientId));
            setConfirmed(res.lines);
            await load();
        } else {
            setError(res.duplicate ? t('duplicate') : res.error);
        }
        setIsSaving(false);
    };

    if (isLoading) {
        return <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>{t('loading')}</div>;
    }

    return (
        <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* Header: proveedor + fecha */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end' }}>
                <div>
                    <label style={labelStyle}>{t('provider')}</label>
                    <select value={providerChoice} onChange={e => setProviderChoice(e.target.value)} style={{ ...inputStyle, minWidth: '220px' }}>
                        <option value="">{t('providerPick')}</option>
                        {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        <option value={OTHER}>{t('providerOther')}</option>
                    </select>
                </div>
                {providerChoice === OTHER && (
                    <div>
                        <label style={labelStyle}>{t('supplierName')}</label>
                        <input value={otherName} onChange={e => setOtherName(e.target.value)} style={{ ...inputStyle, minWidth: '200px' }} />
                    </div>
                )}
                <div>
                    <label style={labelStyle}>{t('date')}</label>
                    <DatePicker value={date} onChange={setDate} locale={locale} max={todayYMD()} />
                </div>
            </div>

            {confirmed && (
                <div style={{ padding: '1rem', borderRadius: '8px', border: '1px solid var(--success)', background: 'rgba(16,185,129,0.1)' }}>
                    <div style={{ fontWeight: 'bold', marginBottom: '0.5rem', color: 'var(--success)' }}>{t('saved')}</div>
                    {confirmed.map((l, i) => (
                        <div key={i}>{t('confirmLine', { name: l.name, credited: fmt(l.credited), unit: unitLabel(l.unitLabel, locale), stock: fmt(l.newStock) })}</div>
                    ))}
                </div>
            )}

            {error && (
                <div style={{ padding: '1rem', borderRadius: '8px', border: '1px solid var(--danger)', color: 'var(--danger)' }}>{error}</div>
            )}

            {/* Rows */}
            {rows.length === 0 && <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-secondary)' }}>{t('empty')}</div>}
            {rows.map((row, idx) => {
                const ing = byId.get(row.ingredientId);
                if (!ing) return null;
                const stock = (ing.inventory?.frozenQty ?? 0) + (ing.inventory?.thawingQty ?? 0);
                const size = packSize(ing);
                return (
                    <div key={row.ingredientId} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-end', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: '1.05rem' }}>{ing.name}</div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                {ing.provider?.name ?? '—'} · {t('stockNow', { stock: fmt(stock), unit: unitLabel(ing.metric, locale) })}
                                {size && <> · {t('packHint', { size })}</>}
                            </div>
                        </div>
                        <div>
                            <label style={labelStyle}>{t('qty')}</label>
                            <input type="number" inputMode="decimal" min="0" step="any" value={row.qty}
                                onChange={e => updateRow(idx, { qty: e.target.value })}
                                style={{ ...inputStyle, width: '110px', fontSize: '1.4rem', fontWeight: 600 }} />
                        </div>
                        <div>
                            <label style={labelStyle}>{t('unit')}</label>
                            <input value={row.unit} onChange={e => updateRow(idx, { unit: e.target.value })} style={{ ...inputStyle, width: '90px' }} />
                        </div>
                        {isWeightMetric(ing.metric) && (
                            <div>
                                <label style={labelStyle}>{t('totalWeight')}</label>
                                <input type="number" inputMode="decimal" min="0" step="any" value={row.weight}
                                    onChange={e => updateRow(idx, { weight: e.target.value })} style={{ ...inputStyle, width: '120px' }} />
                            </div>
                        )}
                        <div>
                            <label style={labelStyle}>{t('price')}</label>
                            <input type="number" inputMode="decimal" min="0" step="0.01" value={row.price}
                                onChange={e => updateRow(idx, { price: e.target.value })} style={{ ...inputStyle, width: '110px' }} />
                        </div>
                        <button onClick={() => setRows(prev => prev.filter((_, i) => i !== idx))}
                            style={{ ...inputStyle, minWidth: '44px', cursor: 'pointer', color: 'var(--text-secondary)' }} aria-label={t('remove')} title={t('remove')}>
                            ✕
                        </button>
                    </div>
                );
            })}

            {/* Picker over all active RAW, provider-less included */}
            <div>
                <button onClick={() => setPickerOpen(o => !o)}
                    style={{ ...inputStyle, cursor: 'pointer', fontWeight: 600, background: 'var(--bg-secondary)' }}>
                    {t('add')}
                </button>
                {pickerOpen && (
                    <div style={{ marginTop: '0.5rem', border: '1px solid var(--border)', borderRadius: '8px', padding: '0.5rem', background: 'var(--bg-secondary)' }}>
                        <input autoFocus value={search} onChange={e => setSearch(e.target.value)} placeholder={t('search')}
                            style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }} />
                        <div style={{ maxHeight: '320px', overflowY: 'auto', marginTop: '0.5rem' }}>
                            {pickerResults.length === 0 && <div style={{ padding: '0.75rem', color: 'var(--text-secondary)' }}>{t('noResults')}</div>}
                            {pickerResults.map(ing => (
                                <button key={ing.id}
                                    onClick={() => { setRows(prev => [...prev, newRow(ing)]); setSearch(''); setPickerOpen(false); }}
                                    style={{ display: 'block', width: '100%', minHeight: '44px', textAlign: 'left', padding: '0.5rem 0.75rem', background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', color: 'var(--text-primary)', cursor: 'pointer' }}>
                                    {ing.name} <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{ing.provider?.name ?? '—'}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <div>
                <button onClick={handleSave} disabled={isSaving}
                    style={{ minHeight: '48px', padding: '0.75rem 1.5rem', background: 'var(--success)', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '1.05rem', cursor: isSaving ? 'default' : 'pointer', opacity: isSaving ? 0.6 : 1 }}>
                    {isSaving ? t('saving') : t('save')}
                </button>
            </div>
        </div>
    );
}
