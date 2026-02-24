'use client';

import { Search, Plus, Eye, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getMenuItems, deleteMenuItem, addMenuItem, editMenuItem } from '@/app/actions/menu';
import MenuModal from '@/components/modals/MenuModal';

export default function MenuPage() {
    const [menuItems, setMenuItems] = useState<any[]>([]);
    const [allIngredients, setAllIngredients] = useState<any[]>([]);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState<any>(null);
    const [searchQuery, setSearchQuery] = useState('');

    const loadData = async () => {
        const data = await getMenuItems();
        setMenuItems(data);
    };

    useEffect(() => {
        loadData();
        import('@/app/actions/inventory').then(m => m.getInventory().then(setAllIngredients));
    }, []);

    const resolveCost = (item: any): number => {
        if (!item) return 0;
        if (item.type === 'RAW') return item.currentPrice || 0;
        if (item.type === 'PROCESSED') {
            if (item.metric?.toLowerCase() === 'units') return item.currentPrice || 0;
            const parentCost = item.parent ? resolveCost(allIngredients.find(dbI => dbI.id === item.parent?.id) || item.parent) : (item.currentPrice || 0);
            return parentCost / Math.max(0.01, (item.yieldPercent / 100));
        }
        if (item.type === 'PREP_RECIPE') {
            if (!item.composedOf || item.composedOf.length === 0) return item.currentPrice || 0;
            const sum = item.composedOf.reduce((acc: number, comp: any) => {
                const dep = allIngredients.find(dbI => dbI.id === comp.ingredientId) || comp.ingredient;
                return acc + (resolveCost(dep) * comp.quantity);
            }, 0);
            return sum / Math.max(0.01, (item.yieldPercent / 100));
        }
        return item.currentPrice || 0;
    };

    const handleSaveMenu = async (data: any) => {
        if (editingItem) {
            await editMenuItem(editingItem.id, data);
        } else {
            await addMenuItem(data);
        }
        setIsAddModalOpen(false);
        setEditingItem(null);
        loadData();
    };

    const handleDelete = async (id: string) => {
        if (confirm("Are you sure you want to delete this menu item?")) {
            await deleteMenuItem(id);
            loadData();
        }
    };

    const groupedMenu = menuItems.filter(item => item.name.toLowerCase().includes(searchQuery.toLowerCase())).reduce((acc, item) => {
        const cat = item.category || 'Uncategorized';
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(item);
        return acc;
    }, {} as Record<string, any[]>);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h1 style={{ fontSize: '2.5rem', marginBottom: '0.25rem' }}>Menu Items & Recipes</h1>
                    <p style={{ color: 'var(--text-secondary)' }}>{menuItems.length} active dishes</p>
                </div>
                <button onClick={() => setIsAddModalOpen(true)} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderRadius: '8px' }}>
                    <Plus size={18} />
                    <span>Create Recipe</span>
                </button>
            </div>

            {/* Search */}
            <div style={{ position: 'relative', maxWidth: '400px' }}>
                <Search size={18} style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                <input
                    type="text"
                    placeholder="Search menu items..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="input-field"
                    style={{ paddingLeft: '2.75rem', backgroundColor: 'rgba(255,255,255,0.03)' }}
                />
            </div>

            {/* Categories */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3rem', marginTop: '1rem' }}>
                {Object.entries(groupedMenu).sort(([catA], [catB]) => catA.localeCompare(catB)).map(([category, items]: [string, any]) => (
                    <div key={category}>
                        <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.5rem', color: 'var(--text-secondary)' }}>
                            {category}
                        </h2>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '1.5rem' }}>
                            {[...items].sort((a: any, b: any) => a.name.localeCompare(b.name)).map((item: any) => {
                                let totalCost = 0;
                                item.recipeIngredients?.forEach((req: any) => {
                                    const ing = req.ingredient;
                                    let unitCost = resolveCost(ing);
                                    totalCost += (unitCost * req.quantity);
                                });

                                const currentFoodCostPct = item.salePrice > 0 ? (totalCost / item.salePrice) * 100 : 0;
                                const isAlert = currentFoodCostPct > item.targetFoodCostPct;
                                const margin = item.salePrice > 0 ? ((item.salePrice - totalCost) / item.salePrice) * 100 : 0;

                                return (
                                    <div key={item.id} className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem', border: isAlert ? '1px solid var(--danger)' : '' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                            <div>
                                                <h3 style={{ fontSize: '1.1rem', marginBottom: '0.2rem' }}>{item.name}</h3>
                                                {isAlert && (
                                                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--danger)', display: 'inline-block', marginBottom: '0.5rem', padding: '0.1rem 0.5rem', background: 'rgba(239,68,68,0.1)', borderRadius: '12px' }}>
                                                        COST ALERT (Target: {item.targetFoodCostPct}%)
                                                    </span>
                                                )}
                                            </div>
                                            <div style={{ display: 'flex', gap: '0.5rem', color: 'var(--text-secondary)' }}>
                                                <button onClick={() => { setEditingItem(item); setIsAddModalOpen(true); }} style={{ color: 'inherit', padding: '0.25rem' }} onMouseOver={(e) => e.currentTarget.style.color = 'var(--text-primary)'} onMouseOut={(e) => e.currentTarget.style.color = 'inherit'}><Pencil size={18} /></button>
                                                <button onClick={() => handleDelete(item.id)} style={{ color: 'var(--danger)', padding: '0.25rem' }}><Trash2 size={18} /></button>
                                            </div>
                                        </div>

                                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                                            <div style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: '8px', padding: '0.75rem', textAlign: 'center' }}>
                                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>Selling Price</div>
                                                <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>${item.salePrice.toFixed(2)}</div>
                                            </div>
                                            <div style={{ flex: 1, backgroundColor: isAlert ? 'rgba(239,68,68,0.1)' : 'rgba(0,0,0,0.2)', borderRadius: '8px', padding: '0.75rem', textAlign: 'center' }}>
                                                <div style={{ fontSize: '0.75rem', color: isAlert ? 'var(--danger)' : 'var(--text-secondary)', marginBottom: '0.25rem' }}>Live Cost</div>
                                                <div style={{ fontSize: '1.1rem', fontWeight: 600, color: isAlert ? 'var(--danger)' : 'var(--text-primary)' }}>
                                                    ${totalCost.toFixed(2)} <span style={{ fontSize: '0.7rem' }}>({currentFoodCostPct.toFixed(1)}%)</span>
                                                </div>
                                            </div>
                                            <div style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px', padding: '0.75rem', textAlign: 'center' }}>
                                                <div style={{ fontSize: '0.75rem', color: 'var(--success)', marginBottom: '0.25rem' }}>Gross Margin</div>
                                                <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--success)' }}>{margin.toFixed(1)}%</div>
                                            </div>
                                        </div>

                                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                            Recipe built from {item.recipeIngredients?.length || 0} items
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>

            <MenuModal
                isOpen={isAddModalOpen}
                onClose={() => { setIsAddModalOpen(false); setEditingItem(null); }}
                onSave={handleSaveMenu}
                initialData={editingItem}
            />
        </div>
    );
}
