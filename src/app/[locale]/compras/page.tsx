'use client';

import { useState, useEffect } from 'react';
import { useLocale } from 'next-intl';
import { useAdmin } from '@/components/AdminContext';
import { ShoppingCart, CheckSquare, Square, PackageSearch } from 'lucide-react';
import { getComprasIngredients, toggleNeedsOrdering } from '@/app/actions/compras';

export default function ComprasPage() {
    const locale = useLocale();
    const { isAdmin } = useAdmin();

    const [activeTab, setActiveTab] = useState('RD_SYSCO');
    const [ingredients, setIngredients] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const tabs = [
        { id: 'RD_SYSCO', label: 'RD & Sysco', providers: ['Restaurant Depot', 'Sysco'] },
        { id: 'PERUANOS', label: 'Productos Peruanos', providers: ['Productos Peruanos', 'JCC Ganoza'] },
        { id: 'MONARCH', label: 'Monarch Seafood', providers: ['Monarch Seafood'] }
    ];

    useEffect(() => {
        loadData();
    }, [activeTab]);

    const loadData = async () => {
        setIsLoading(true);
        const activeTabInfo = tabs.find(t => t.id === activeTab);
        if (activeTabInfo) {
            const res = await getComprasIngredients(activeTabInfo.providers);
            if (res.success && res.data) {
                setIngredients(res.data);
            }
        }
        setIsLoading(false);
    };

    const handleToggle = async (id: string, currentVal: boolean) => {
        // Optimistic UI update
        const updated = ingredients.map(ing =>
            ing.id === id ? { ...ing, needsOrdering: !currentVal } : ing
        );
        setIngredients(updated);

        const res = await toggleNeedsOrdering(id, !currentVal);
        if (!res.success) {
            // Revert on failure
            setIngredients(ingredients);
            alert('Failed to update status');
        }
    };

    return (
        <div style={{ padding: '2rem', maxWidth: '1400px', margin: '0 auto', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h1 style={{ fontSize: '2.5rem', marginBottom: '0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <ShoppingCart size={36} color="var(--accent-primary)" />
                        {locale === 'es' ? 'Lista de Compras' : 'Shopping List'}
                    </h1>
                    <p style={{ color: 'var(--text-secondary)' }}>{locale === 'es' ? 'Gestión de pedidos por proveedor.' : 'Provider-based order management.'}</p>
                </div>
            </div>

            <div className="glass-panel" style={{ padding: '1rem', display: 'flex', gap: '1rem', marginTop: '2rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id)}
                        style={{
                            padding: '0.6rem 1.2rem',
                            borderRadius: '8px',
                            fontWeight: 500,
                            fontSize: '0.95rem',
                            color: activeTab === tab.id ? 'white' : 'var(--text-secondary)',
                            background: activeTab === tab.id ? 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))' : 'transparent',
                            border: activeTab === tab.id ? 'none' : '1px solid rgba(255,255,255,0.1)',
                            cursor: 'pointer',
                            transition: 'all 0.2s'
                        }}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            <div className="glass-panel" style={{ flex: 1, padding: 0, overflow: 'hidden' }}>
                {isLoading ? (
                    <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading...</div>
                ) : ingredients.length === 0 ? (
                    <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                        <PackageSearch size={48} opacity={0.5} />
                        <p>{locale === 'es' ? 'No se encontraron productos para este proveedor.' : 'No items found for this provider.'}</p>
                    </div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                                    <th style={{ padding: '1rem', fontWeight: 600, width: '60px' }}></th>
                                    <th style={{ padding: '1rem', fontWeight: 600 }}>{locale === 'es' ? 'Ingrediente' : 'Ingredient'}</th>
                                    {isAdmin && (
                                        <th style={{ padding: '1rem', fontWeight: 600, width: '200px', textAlign: 'right' }}>{locale === 'es' ? 'Stock Actual' : 'Current Stock'}</th>
                                    )}
                                </tr>
                            </thead>
                            <tbody>
                                {ingredients.map(ing => {
                                    const qty = ing.inventory?.quantity ?? 0;
                                    let displayStock = `${qty} ${ing.metric}`;
                                    if (ing.isPacked && ing.unitsPerPack > 0 && qty > 0) {
                                        const totalPacks = Math.floor(qty / ing.unitsPerPack);
                                        const packLabel = (locale === 'es' && ing.packUnit.toLowerCase() === 'bags') ? 'Bolsas' :
                                            (locale === 'es' && ing.packUnit.toLowerCase() === 'boxes') ? 'Cajas' : ing.packUnit;
                                        displayStock = `${totalPacks} ${packLabel} (${qty} ${ing.metric})`;
                                    }

                                    return (
                                        <tr
                                            key={ing.id}
                                            style={{
                                                borderBottom: '1px solid var(--border)',
                                                transition: 'background 0.2s',
                                                background: ing.needsOrdering ? 'rgba(239, 68, 68, 0.05)' : 'transparent'
                                            }}
                                            onMouseOver={(e) => e.currentTarget.style.background = ing.needsOrdering ? 'rgba(239, 68, 68, 0.1)' : 'var(--bg-secondary)'}
                                            onMouseOut={(e) => e.currentTarget.style.background = ing.needsOrdering ? 'rgba(239, 68, 68, 0.05)' : 'transparent'}
                                        >
                                            <td style={{ padding: '1rem', textAlign: 'center' }}>
                                                <button
                                                    onClick={() => handleToggle(ing.id, ing.needsOrdering)}
                                                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: 'transparent', cursor: 'pointer', padding: '0.25rem' }}
                                                >
                                                    {ing.needsOrdering ? (
                                                        <CheckSquare size={24} color="var(--danger)" />
                                                    ) : (
                                                        <Square size={24} color="var(--text-secondary)" />
                                                    )}
                                                </button>
                                            </td>
                                            <td style={{ padding: '1rem', fontWeight: 500, color: ing.needsOrdering ? 'var(--danger)' : 'inherit' }}>
                                                {locale === 'es' && ing.nameEs ? ing.nameEs : ing.name}
                                                <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 400, marginTop: '0.2rem' }}>
                                                    {ing.provider?.name || 'Unknown'}
                                                </span>
                                            </td>
                                            {isAdmin && (
                                                <td style={{ padding: '1rem', textAlign: 'right', fontWeight: 500 }}>
                                                    {displayStock}
                                                </td>
                                            )}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}
