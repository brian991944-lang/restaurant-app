'use client';

import { X, Trash2, Globe, FileEdit } from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';
import { useState, useEffect } from 'react';
import { getDropdownOptions, addDropdownOption, deleteDropdownOption, editDropdownOption } from '@/app/actions/dropdownOptions';
import { getCategories, addCategory, deleteCategory, editCategory, getProviders, addProvider, deleteProvider, editProvider } from '@/app/actions/inventory';

interface ManageOptionsModalProps {
    isOpen: boolean;
    onClose: () => void;
    categoryType?: 'INGREDIENT' | 'TASK' | 'RECIPE';
}

export default function ManageOptionsModal({ isOpen, onClose, categoryType = 'INGREDIENT' }: ManageOptionsModalProps) {
    const t = useTranslations('Inventory');
    const locale = useLocale();
    const [selectedGroup, setSelectedGroup] = useState<'Category' | 'Type' | 'Provider'>('Category');
    const [newOptionName, setNewOptionName] = useState('');
    const [newOptionNameEs, setNewOptionNameEs] = useState('');
    const [autoTranslate, setAutoTranslate] = useState(true);
    const [options, setOptions] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [editingOption, setEditingOption] = useState<any>(null);

    useEffect(() => {
        if (isOpen) {
            loadOptions();
            setEditingOption(null);
            setNewOptionName('');
            setNewOptionNameEs('');
            setAutoTranslate(true);
        }
    }, [isOpen, selectedGroup]);

    const loadOptions = async () => {
        setIsLoading(true);
        try {
            if (selectedGroup === 'Category') {
                const data = await getCategories(categoryType);
                setOptions(data);
            } else if (selectedGroup === 'Provider') {
                const data = await getProviders();
                setOptions(data);
            } else {
                const data = await getDropdownOptions(selectedGroup);
                setOptions(data);
            }
        } catch (e) {
            console.error(e);
        }
        setIsLoading(false);
    };

    const handleAddOrEdit = async () => {
        if (!newOptionName) return;
        setIsLoading(true);
        let res;

        if (editingOption) {
            if (selectedGroup === 'Category') {
                res = await editCategory(editingOption.id, newOptionName, autoTranslate ? undefined : newOptionNameEs);
            } else if (selectedGroup === 'Provider') {
                res = await editProvider(editingOption.id, newOptionName);
            } else {
                res = await editDropdownOption(editingOption.id, newOptionName, autoTranslate, autoTranslate ? undefined : newOptionNameEs);
            }
        } else {
            if (selectedGroup === 'Category') {
                res = await addCategory(newOptionName, 'FOOD', autoTranslate ? undefined : newOptionNameEs, categoryType as any); // default to FOOD department
            } else if (selectedGroup === 'Provider') {
                res = await addProvider(newOptionName);
            } else {
                res = await addDropdownOption(selectedGroup, newOptionName, autoTranslate, autoTranslate ? undefined : newOptionNameEs);
            }
        }

        if (res.success) {
            setNewOptionName('');
            setNewOptionNameEs('');
            setEditingOption(null);
            await loadOptions();
        } else {
            alert(res.error || 'Failed to save option. Check your database permissions on Vercel.');
        }
        setIsLoading(false);
    };

    const handleDelete = async (id: string) => {
        let res;
        if (selectedGroup === 'Category') {
            res = await deleteCategory(id);
        } else if (selectedGroup === 'Provider') {
            res = await deleteProvider(id);
        } else {
            res = await deleteDropdownOption(id);
        }
        if (res.success) {
            loadOptions();
        }
    };

    if (!isOpen) return null;

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '1rem'
        }}>
            <div className="glass-panel" style={{ width: '100%', maxWidth: '600px', padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem', animation: 'fadeIn 0.2s ease-out', background: 'var(--bg-primary)', maxHeight: '90vh', overflowY: 'auto' }}>

                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '1rem' }}>
                    <h2 style={{ fontSize: '1.5rem', margin: 0 }}>{t('manage_options_title')}</h2>
                    <button onClick={onClose} style={{ color: 'var(--text-secondary)', padding: '0.25rem' }}><X size={20} /></button>
                </div>

                {/* Group Selector */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                        {categoryType === 'TASK' ? (locale === 'es' ? 'Tipo de Configuración' : 'Configuration Type') :
                            categoryType === 'RECIPE' ? (locale === 'es' ? 'Tipo de Categoría' : 'Category Type') :
                                t('option_type')}
                    </label>
                    <select
                        className="input-field"
                        value={selectedGroup}
                        onChange={(e) => setSelectedGroup(e.target.value as any)}
                        style={{ padding: '0.8rem', fontSize: '1rem' }}>
                        <option value="Category">
                            {categoryType === 'TASK' ? (locale === 'es' ? 'Categoría de Tarea' : 'Task Category') :
                                categoryType === 'RECIPE' ? (locale === 'es' ? 'Categoría de Receta' : 'Recipe Category') :
                                    t('category')}
                        </option>
                        {categoryType === 'INGREDIENT' && <option value="Provider">{locale === 'es' ? 'Proveedor' : 'Provider'}</option>}
                    </select>
                </div>

                {/* Current Options List View */}
                <div style={{ border: '1px solid var(--border)', borderRadius: '12px', overflowY: 'auto', maxHeight: '40vh', minHeight: '150px' }}>
                    {isLoading ? (
                        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Loading...</div>
                    ) : options.length === 0 ? (
                        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>No options found for this group.</div>
                    ) : (options.map((opt, idx) => (
                        <div key={opt.id} style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            padding: '1rem', background: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)',
                            borderBottom: idx === options.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.05)'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <span style={{ fontWeight: 500 }}>{locale === 'es' && opt.nameEs ? opt.nameEs : opt.name}</span>
                                {opt.isTranslated && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.2rem', background: 'rgba(59, 130, 246, 0.2)', color: 'var(--accent-primary)', padding: '0.2rem 0.5rem', borderRadius: '12px', fontSize: '0.7rem' }}>
                                        <Globe size={12} /> Auto-Translation On
                                    </div>
                                )}
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <button onClick={() => {
                                    setEditingOption(opt);
                                    setNewOptionName(opt.name);
                                    setNewOptionNameEs(opt.nameEs || '');
                                    setAutoTranslate(opt.isTranslated ?? false);
                                }} style={{ color: 'var(--accent-primary)', background: 'rgba(59, 130, 246, 0.1)', padding: '0.4rem', borderRadius: '8px' }}>
                                    <FileEdit size={16} />
                                </button>
                                <button onClick={() => handleDelete(opt.id)} style={{ color: 'var(--danger)', background: 'rgba(239, 68, 68, 0.1)', padding: '0.4rem', borderRadius: '8px' }}>
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </div>
                    )))}
                </div>

                {/* Addition Form */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem', background: 'rgba(255,255,255,0.02)', padding: '1.5rem', borderRadius: '12px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{t('new_option_name')}</label>
                        <input
                            type="text"
                            className="input-field"
                            value={newOptionName}
                            onChange={(e) => setNewOptionName(e.target.value)}
                            placeholder="Type new option..."
                        />
                    </div>

                    {selectedGroup !== 'Provider' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <input
                                type="checkbox"
                                checked={autoTranslate}
                                onChange={(e) => setAutoTranslate(e.target.checked)}
                                id="autoTranslateCheck"
                                style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: 'var(--accent-primary)' }}
                            />
                            <label htmlFor="autoTranslateCheck" style={{ fontSize: '0.9rem', color: 'var(--text-primary)', cursor: 'pointer' }}>
                                {t('auto_translate') || 'Auto-Translate'}
                            </label>
                        </div>
                    )}

                    {!autoTranslate && selectedGroup !== 'Provider' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Spanish Name</label>
                            <input
                                type="text"
                                className="input-field"
                                value={newOptionNameEs}
                                onChange={(e) => setNewOptionNameEs(e.target.value)}
                                placeholder="Type Spanish name..."
                            />
                        </div>
                    )}

                    <button
                        className="btn-primary"
                        onClick={handleAddOrEdit}
                        disabled={!newOptionName || isLoading}
                        style={{ marginTop: '0.5rem', borderRadius: '8px', opacity: (newOptionName && !isLoading) ? 1 : 0.5, cursor: (newOptionName && !isLoading) ? 'pointer' : 'not-allowed' }}>
                        {isLoading ? 'Saving...' : (editingOption ? 'Save Changes' : t('add_option'))}
                    </button>
                    {editingOption && (
                        <button
                            onClick={() => {
                                setEditingOption(null);
                                setNewOptionName('');
                                setNewOptionNameEs('');
                            }}
                            style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                            Cancel Edit
                        </button>
                    )}
                </div>
            </div>
        </div >
    );
}
