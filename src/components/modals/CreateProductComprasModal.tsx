'use client';

import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { getCategories } from '@/app/actions/inventory';

interface CreateProductComprasModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: () => void;
    defaultProvider: string;
    locale: string;
}

const ALLOWED_METRICS = ['Kg', 'g', 'Lbs', 'Solid Oz', 'Fl Oz', 'ml', 'L', 'Units'];

export default function CreateProductComprasModal({
    isOpen,
    onClose,
    onSave,
    defaultProvider,
    locale
}: CreateProductComprasModalProps) {
    const [name, setName] = useState('');
    const [selectedMetric, setSelectedMetric] = useState('Units');
    const [selectedCategory, setSelectedCategory] = useState('');
    const [categories, setCategories] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setName('');
            setSelectedMetric('Units');
            setSelectedCategory('');
            loadCategories();
        }
    }, [isOpen]);

    const loadCategories = async () => {
        setIsLoading(true);
        try {
            const catData = await getCategories('INGREDIENT');
            setCategories(catData);
            if (catData.length > 0) {
                setSelectedCategory(catData[0].name);
            }
        } catch (e) {
            console.error('Failed to load categories:', e);
        }
        setIsLoading(false);
    };

    const toTitleCase = (str: string) => {
        return str.replace(
            /\w\S*/g,
            function (txt) {
                return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase();
            }
        );
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim() || !selectedCategory) return;

        setIsSaving(true);
        try {
            const { addIngredient } = await import('@/app/actions/inventory');
            const res = await addIngredient({
                name: toTitleCase(name),
                metric: selectedMetric,
                categoryName: selectedCategory,
                providerName: defaultProvider,
                type: 'RAW',
                initialQty: 0,
                autoTranslate: true
            });

            if (res.success) {
                onSave();
                onClose();
            } else {
                alert(res.error || 'Failed to save product');
            }
        } catch (error) {
            console.error('Failed to add product:', error);
            alert('An error occurred while saving.');
        }
        setIsSaving(false);
    };

    if (!isOpen) return null;

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
            padding: '1rem'
        }}>
            <div className="glass-panel" style={{ width: '100%', maxWidth: '420px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem', animation: 'fadeIn 0.2s ease-out', background: 'var(--bg-primary)', maxHeight: '90vh', overflowY: 'auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem' }}>
                    <h2 style={{ fontSize: '1.35rem', margin: 0, fontWeight: 600 }}>
                        {locale === 'es' ? 'Crear Nuevo Producto' : 'Create New Product'}
                    </h2>
                    <button type="button" onClick={onClose} style={{ color: 'var(--text-secondary)', padding: '0.25rem', display: 'flex', alignItems: 'center' }}>
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                            {locale === 'es' ? 'Nombre del Ingrediente' : 'Ingredient Name'}
                        </label>
                        <input
                            type="text"
                            className="input-field"
                            placeholder={locale === 'es' ? 'ej. Carne para Lomo' : 'e.g. Beef for Loin'}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                            autoFocus
                            style={{ fontSize: '0.95rem' }}
                        />
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                            {locale === 'es' ? 'Unidad por Defecto' : 'Default Unit'}
                        </label>
                        <select
                            className="input-field"
                            value={selectedMetric}
                            onChange={(e) => setSelectedMetric(e.target.value)}
                            required
                            style={{ fontSize: '0.95rem', cursor: 'pointer' }}
                        >
                            {ALLOWED_METRICS.map(m => (
                                <option key={m} value={m}>
                                    {locale === 'es' && m === 'Units' ? 'Unidades' : m}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                            {locale === 'es' ? 'Categoría por Defecto' : 'Default Category'}
                        </label>
                        {isLoading ? (
                            <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', padding: '0.5rem' }}>
                                {locale === 'es' ? 'Cargando categorías...' : 'Loading categories...'}
                            </div>
                        ) : (
                            <select
                                className="input-field"
                                value={selectedCategory}
                                onChange={(e) => setSelectedCategory(e.target.value)}
                                required
                                style={{ fontSize: '0.95rem', cursor: 'pointer' }}
                            >
                                {categories.map(c => (
                                    <option key={c.id} value={c.name}>
                                        {locale === 'es' && c.nameEs ? c.nameEs : c.name}
                                    </option>
                                ))}
                            </select>
                        )}
                    </div>

                    {defaultProvider && (
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.02)', padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
                            <span>{locale === 'es' ? 'Proveedor asignado:' : 'Assigned supplier:'}</span>
                            <strong style={{ color: 'var(--accent-primary)' }}>{defaultProvider}</strong>
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: '1rem', marginTop: '0.5rem' }}>
                        <button
                            type="button"
                            onClick={onClose}
                            style={{
                                padding: '0.6rem 1.2rem',
                                borderRadius: '8px',
                                border: '1px solid var(--border)',
                                color: 'var(--text-secondary)',
                                fontWeight: 500,
                                fontSize: '0.95rem',
                                transition: 'all 0.2s',
                                cursor: 'pointer'
                            }}
                            onMouseOver={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
                            onMouseOut={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
                        >
                            {locale === 'es' ? 'Cancelar' : 'Cancel'}
                        </button>
                        <button
                            type="submit"
                            disabled={isSaving}
                            className="btn-primary"
                            style={{
                                padding: '0.6rem 1.2rem',
                                borderRadius: '8px',
                                fontWeight: 600,
                                fontSize: '0.95rem',
                                transition: 'all 0.2s',
                                opacity: isSaving ? 0.7 : 1,
                                cursor: isSaving ? 'not-allowed' : 'pointer'
                            }}
                        >
                            {isSaving ? (locale === 'es' ? 'Guardando...' : 'Saving...') : (locale === 'es' ? 'Guardar' : 'Save')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
