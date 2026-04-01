'use client';

import { X, Plus, Minus } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

interface AdjustStockModalProps {
    ingredient: any;
    onClose: () => void;
    onSave: (data: { type: 'ADD' | 'REMOVE', amount: number, notes: string }) => Promise<void>;
}

export default function AdjustStockModal({ ingredient, onClose, onSave }: AdjustStockModalProps) {
    const t = useTranslations('Inventory');
    const [amount, setAmount] = useState<number>(1);
    const [action, setAction] = useState<'ADD' | 'REMOVE'>('ADD');
    const [notes, setNotes] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    if (!ingredient) return null;

    const unitLabel = ingredient.isPacked ? 'Bolsas / Bags' : ingredient.metric;

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        try {
            await onSave({ type: action, amount, notes });
            onClose();
        } catch (error) {
            console.error('Error adjusting stock:', error);
            setIsSubmitting(false);
        }
    };

    return (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem', backdropFilter: 'blur(4px)' }}>
            <div className="glass-panel" style={{ width: '100%', maxWidth: '400px', maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.5rem', borderBottom: '1px solid var(--border)' }}>
                    <div>
                        <h2 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>Ajustar / Adjust Stock</h2>
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{ingredient.name}</span>
                    </div>
                    <button onClick={onClose} style={{ background: 'transparent', color: 'var(--text-secondary)' }}><X size={20} /></button>
                </div>

                <form onSubmit={handleSave} style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                        <button
                            type="button"
                            onClick={() => setAction('ADD')}
                            style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                                padding: '1rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600,
                                background: action === 'ADD' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(255,255,255,0.05)',
                                color: action === 'ADD' ? 'var(--success)' : 'var(--text-secondary)',
                                border: action === 'ADD' ? '1px solid var(--success)' : '1px solid var(--border)',
                                transition: 'all 0.2s ease'
                            }}
                        >
                            <Plus size={18} /> Añadir / Add
                        </button>
                        <button
                            type="button"
                            onClick={() => setAction('REMOVE')}
                            style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                                padding: '1rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600,
                                background: action === 'REMOVE' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255,255,255,0.05)',
                                color: action === 'REMOVE' ? 'var(--danger)' : 'var(--text-secondary)',
                                border: action === 'REMOVE' ? '1px solid var(--danger)' : '1px solid var(--border)',
                                transition: 'all 0.2s ease'
                            }}
                        >
                            <Minus size={18} /> Retirar / Remove
                        </button>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                            Cantidad / Quantity (<span style={{ color: 'var(--text-primary)' }}>{unitLabel}</span>)
                        </label>
                        <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            className="input-field"
                            style={{ fontSize: '1.2rem', padding: '1rem' }}
                            value={amount}
                            onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                            required
                        />
                        {ingredient.isPacked && (
                            <span style={{ fontSize: '0.8rem', color: 'var(--accent-primary)', marginTop: '0.2rem' }}>
                                = {Number((amount * (ingredient.unitsPerPack || 1)).toFixed(2))} {ingredient.packUnit || ingredient.metric}
                            </span>
                        )}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <label style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Nota / Reason (Opcional)</label>
                        <input
                            type="text"
                            className="input-field"
                            placeholder="e.g. Received new shipment | Waste"
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                        />
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1rem' }}>
                        <button type="button" onClick={onClose} disabled={isSubmitting} style={{ padding: '0.6rem 1rem', borderRadius: '8px', color: 'var(--text-secondary)', background: 'transparent' }}>
                            Cancelar
                        </button>
                        <button type="submit" className="btn-primary" disabled={isSubmitting} style={{ padding: '0.6rem 1.5rem', borderRadius: '8px' }}>
                            {isSubmitting ? 'Guardando...' : 'Confirmar'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

