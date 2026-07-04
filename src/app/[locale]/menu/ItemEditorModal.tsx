'use client';

import { useEffect, useState } from 'react';
import { X, Languages } from 'lucide-react';
import ImageUpload from '@/components/ui/ImageUpload';
import { createMenuItem, updateMenuItem } from '@/app/actions/menuAdmin';

interface ItemEditorModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSaved: () => void;
    categories: any[];       // active MenuCategory rows for the dropdown
    initialData?: any | null; // MenuItem row when editing, null when creating
    defaultCategoryId?: string | null; // preselected category for new items
}

export default function ItemEditorModal({ isOpen, onClose, onSaved, categories, initialData, defaultCategoryId }: ItemEditorModalProps) {
    const [name, setName] = useState('');
    const [nameEs, setNameEs] = useState('');
    const [descriptionEn, setDescriptionEn] = useState('');
    const [descriptionEs, setDescriptionEs] = useState('');
    const [taglineEn, setTaglineEn] = useState('');
    const [taglineEs, setTaglineEs] = useState('');
    const [salePrice, setSalePrice] = useState('0');
    const [menuCategoryId, setMenuCategoryId] = useState('');
    const [isAvailable, setIsAvailable] = useState(true);
    const [isFeatured, setIsFeatured] = useState(false);
    const [photoUrl, setPhotoUrl] = useState('');
    const [photoUrls, setPhotoUrls] = useState<string[]>([]);
    const [videoUrl, setVideoUrl] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setError(null);
            if (initialData) {
                setName(initialData.name || '');
                setNameEs(initialData.nameEs || '');
                setDescriptionEn(initialData.descriptionEn || '');
                setDescriptionEs(initialData.descriptionEs || '');
                setTaglineEn(initialData.taglineEn || '');
                setTaglineEs(initialData.taglineEs || '');
                setSalePrice((initialData.salePrice ?? 0).toString());
                setMenuCategoryId(initialData.menuCategoryId || '');
                setIsAvailable(initialData.isAvailable ?? true);
                setIsFeatured(initialData.isFeatured ?? false);
                setPhotoUrl(initialData.photoUrl || '');
                setPhotoUrls(initialData.photoUrls || []);
                setVideoUrl(initialData.videoUrl || '');
            } else {
                setName('');
                setNameEs('');
                setDescriptionEn('');
                setDescriptionEs('');
                setTaglineEn('');
                setTaglineEs('');
                setSalePrice('0');
                setMenuCategoryId(defaultCategoryId || '');
                setIsAvailable(true);
                setIsFeatured(false);
                setPhotoUrl('');
                setPhotoUrls([]);
                setVideoUrl('');
            }
        }
    }, [isOpen, initialData, defaultCategoryId]);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setIsSaving(true);
        const payload = {
            name,
            nameEs,
            descriptionEn,
            descriptionEs,
            taglineEn,
            taglineEs,
            salePrice: parseFloat(salePrice) || 0,
            menuCategoryId: menuCategoryId || null,
            photoUrl: photoUrl || null,
            photoUrls,
            videoUrl,
            isAvailable,
            isFeatured
        };
        const result = initialData
            ? await updateMenuItem(initialData.id, payload)
            : await createMenuItem(payload);
        setIsSaving(false);
        if (result.success) {
            onSaved();
            onClose();
        } else {
            setError(result.error || 'Error al guardar.');
        }
    };

    const labelStyle: React.CSSProperties = { fontSize: '0.9rem', color: 'var(--text-secondary)' };
    const fieldStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '0.5rem' };

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '1rem'
        }}>
            <div className="glass-panel" style={{ width: '100%', maxWidth: '700px', maxHeight: '90vh', overflowY: 'auto', padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1.5rem', background: 'var(--bg-primary)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', paddingBottom: '1rem' }}>
                    <h2 style={{ fontSize: '1.5rem', margin: 0 }}>{initialData ? 'Editar Plato' : 'Nuevo Plato'}</h2>
                    <button onClick={onClose} style={{ color: 'var(--text-secondary)', padding: '0.5rem' }}><X size={20} /></button>
                </div>

                {error && (
                    <div style={{ color: '#ef4444', fontSize: '0.9rem', padding: '0.75rem', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div style={fieldStyle}>
                            <label style={labelStyle}>Nombre (EN) *</label>
                            <input value={name} onChange={e => setName(e.target.value)} type="text" className="input-field" placeholder="p.ej. Lomo Saltado" required />
                        </div>
                        <div style={fieldStyle}>
                            <label style={labelStyle}>Nombre (ES)</label>
                            <input value={nameEs} onChange={e => setNameEs(e.target.value)} type="text" className="input-field" placeholder="p.ej. Lomo Saltado" />
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div style={fieldStyle}>
                            <label style={labelStyle}>Descripción (EN)</label>
                            <textarea value={descriptionEn} onChange={e => setDescriptionEn(e.target.value)} className="input-field" rows={3} style={{ resize: 'vertical' }} />
                        </div>
                        <div style={fieldStyle}>
                            <label style={labelStyle}>Descripción (ES)</label>
                            <textarea value={descriptionEs} onChange={e => setDescriptionEs(e.target.value)} className="input-field" rows={3} style={{ resize: 'vertical' }} />
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div style={fieldStyle}>
                            <label style={labelStyle}>Frase (EN) <span style={{ fontSize: '0.8rem' }}>({taglineEn.length}/60)</span></label>
                            <input value={taglineEn} onChange={e => setTaglineEn(e.target.value)} type="text" maxLength={60} className="input-field" placeholder="e.g. Flame-seared over charcoal" />
                        </div>
                        <div style={fieldStyle}>
                            <label style={labelStyle}>Frase (ES) <span style={{ fontSize: '0.8rem' }}>({taglineEs.length}/60)</span></label>
                            <input value={taglineEs} onChange={e => setTaglineEs(e.target.value)} type="text" maxLength={60} className="input-field" placeholder="p.ej. Sellado a la llama sobre carbón" />
                        </div>
                    </div>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '-0.75rem' }}>
                        Frase corta con gancho — cómo lo preparamos. Aparece en la vista ampliada.
                    </span>

                    {/* Future auto-translation hook: wire this button to a translation
                        service to fill the ES fields from the EN fields (or vice versa). */}
                    <button
                        type="button"
                        disabled
                        title="Próximamente"
                        style={{
                            alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '0.5rem',
                            padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid var(--border)',
                            background: 'var(--bg-secondary)', color: 'var(--text-secondary)',
                            cursor: 'not-allowed', opacity: 0.6, fontSize: '0.85rem'
                        }}
                    >
                        <Languages size={16} />
                        Traducir automáticamente
                    </button>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <div style={fieldStyle}>
                            <label style={labelStyle}>Precio ($)</label>
                            <input value={salePrice} onChange={e => setSalePrice(e.target.value)} type="number" step="0.01" min="0" className="input-field" placeholder="25.00" />
                        </div>
                        <div style={fieldStyle}>
                            <label style={labelStyle}>Categoría</label>
                            <select value={menuCategoryId} onChange={e => setMenuCategoryId(e.target.value)} className="input-field">
                                <option value="">Sin categoría</option>
                                {categories.map((cat: any) => (
                                    <option key={cat.id} value={cat.id}>{cat.nameEs} / {cat.nameEn}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '2rem' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', minHeight: '44px' }}>
                            <input type="checkbox" checked={isAvailable} onChange={e => setIsAvailable(e.target.checked)} style={{ width: '20px', height: '20px' }} />
                            <span>Disponible</span>
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', minHeight: '44px' }}>
                            <input type="checkbox" checked={isFeatured} onChange={e => setIsFeatured(e.target.checked)} style={{ width: '20px', height: '20px' }} />
                            <span>Destacado</span>
                        </label>
                    </div>

                    <div style={fieldStyle}>
                        <label style={labelStyle}>Foto principal <span style={{ fontSize: '0.8rem' }}>(portada de la tarjeta)</span></label>
                        <ImageUpload
                            bucketName="restaurant-assets"
                            currentUrl={photoUrl || undefined}
                            onUploadComplete={(url) => setPhotoUrl(url)}
                            onRemove={() => setPhotoUrl('')}
                            placeholder="Subir foto principal"
                        />
                    </div>

                    <div style={fieldStyle}>
                        <label style={labelStyle}>Galería <span style={{ fontSize: '0.8rem' }}>({photoUrls.length}/6 — se muestra en la vista ampliada)</span></label>
                        {photoUrls.length > 0 && (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: '0.5rem' }}>
                                {photoUrls.map((url, index) => (
                                    <div key={`${url}-${index}`} style={{ position: 'relative', borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border)' }}>
                                        <img src={url} alt={`Galería ${index + 1}`} style={{ width: '100%', height: '96px', objectFit: 'cover', display: 'block' }} />
                                        <button
                                            type="button"
                                            onClick={() => setPhotoUrls(prev => prev.filter((_, i) => i !== index))}
                                            title="Quitar foto"
                                            style={{
                                                position: 'absolute', top: '4px', right: '4px',
                                                background: 'rgba(0,0,0,0.55)', color: 'white', border: 'none',
                                                borderRadius: '50%', width: '24px', height: '24px',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer'
                                            }}
                                        >
                                            <X size={14} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                        {photoUrls.length < 6 && (
                            <ImageUpload
                                bucketName="restaurant-assets"
                                onUploadComplete={(url) => setPhotoUrls(prev => prev.length < 6 ? [...prev, url] : prev)}
                                placeholder="Agregar foto a la galería"
                            />
                        )}
                    </div>

                    <div style={fieldStyle}>
                        <label style={labelStyle}>Video URL</label>
                        <input value={videoUrl} onChange={e => setVideoUrl(e.target.value)} type="text" className="input-field" placeholder="https://..." />
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>URL directa de video MP4 — opcional</span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', borderTop: '1px solid var(--border)', paddingTop: '1.25rem' }}>
                        <button type="button" onClick={onClose} style={{ padding: '0.65rem 1.25rem', borderRadius: '8px', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer', minHeight: '44px' }}>
                            Cancelar
                        </button>
                        <button type="submit" disabled={isSaving} className="btn-primary" style={{ borderRadius: '8px', minHeight: '44px', opacity: isSaving ? 0.7 : 1 }}>
                            {isSaving ? 'Guardando...' : 'Guardar'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
