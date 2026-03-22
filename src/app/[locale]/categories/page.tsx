'use client';

import { Search, Plus, Eye, Pencil, Trash2 } from 'lucide-react';

interface Category {
    id: string;
    name: string;
    department: 'FOOD' | 'DRINKS' | 'CLEANING';
    itemCount: number;
}

const MOCK_CATEGORIES: Category[] = [
    { id: '1', name: 'Appetizers', department: 'FOOD', itemCount: 4 },
    { id: '2', name: 'Mains', department: 'FOOD', itemCount: 8 },
    { id: '3', name: 'Sides', department: 'FOOD', itemCount: 3 },
    { id: '4', name: 'Non-Alcoholic', department: 'DRINKS', itemCount: 5 },
    { id: '5', name: 'Cocktails', department: 'DRINKS', itemCount: 6 },
    { id: '6', name: 'Front of House', department: 'CLEANING', itemCount: 8 },
    { id: '7', name: 'Kitchen', department: 'CLEANING', itemCount: 12 },
];

export default function CategoriesPage() {
    const getDepartmentColor = (dept: string) => {
        switch (dept) {
            case 'FOOD': return { bg: 'rgba(59, 130, 246, 0.2)', text: 'var(--accent-primary)' };
            case 'DRINKS': return { bg: 'rgba(245, 158, 11, 0.2)', text: 'var(--warning)' };
            case 'CLEANING': return { bg: 'rgba(16, 185, 129, 0.2)', text: 'var(--success)' };
            default: return { bg: 'rgba(255, 255, 255, 0.1)', text: 'var(--text-primary)' };
        }
    };

    const groupedCategories = MOCK_CATEGORIES.reduce((acc, cat) => {
        if (!acc[cat.department]) acc[cat.department] = [];
        acc[cat.department].push(cat);
        return acc;
    }, {} as Record<string, Category[]>);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h1 style={{ fontSize: '2.5rem', marginBottom: '0.25rem' }}>Categories Structure</h1>
                    <p style={{ color: 'var(--text-secondary)' }}>Manage your ingredient and menu categories</p>
                </div>
                <button className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderRadius: '8px' }}>
                    <Plus size={18} />
                    <span>Add Category</span>
                </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '2rem' }}>

                {/* Iterate over Departments */}
                {Object.entries(groupedCategories).map(([dept, categories]) => {
                    const deptColors = getDepartmentColor(dept);
                    return (
                        <div key={dept} className="glass-panel" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', padding: '1.5rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '1rem' }}>
                                <h2 style={{ fontSize: '1.25rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                    <span style={{
                                        display: 'inline-block', width: '12px', height: '12px', borderRadius: '50%',
                                        backgroundColor: deptColors.text, boxShadow: `0 0 8px ${deptColors.text}`
                                    }}></span>
                                    {dept}
                                </h2>
                                <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{categories.length} categories</span>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                {categories.map(category => (
                                    <div key={category.id} style={{
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                        padding: '0.75rem 1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '8px',
                                        border: '1px solid var(--border)'
                                    }}>
                                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                                            <span style={{ fontWeight: 500 }}>{category.name}</span>
                                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{category.itemCount} items linked</span>
                                        </div>

                                        <div style={{ display: 'flex', gap: '0.5rem', color: 'var(--text-secondary)' }}>
                                            <button style={{ color: 'inherit', padding: '0.25rem' }} onMouseOver={(e) => e.currentTarget.style.color = 'var(--text-primary)'} onMouseOut={(e) => e.currentTarget.style.color = 'inherit'}><Pencil size={16} /></button>
                                            <button style={{ color: 'var(--danger)', padding: '0.25rem' }}><Trash2 size={16} /></button>
                                        </div>
                                    </div>
                                ))}
                            </div>

                        </div>
                    );
                })}

            </div>
        </div>
    );
}
