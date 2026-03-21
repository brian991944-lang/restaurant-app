'use client';

import React, { useState } from 'react';
import { useAdmin } from '../AdminContext';
import { useWorkstation } from '../WorkstationContext';
import { ChefHat, Coffee, ShieldAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';

export default function WorkstationModal() {
    const { isAdmin } = useAdmin();
    const { station, setStation, isLoaded } = useWorkstation();
    const [selected, setSelected] = useState<'Cocina' | 'Salon' | ''>('');
    const t = useTranslations('Nav');

    // Only block if we're loaded, not admin, and have no station.
    if (!isLoaded || isAdmin || station) return null;

    const handleConfirm = () => {
        if (selected) {
            setStation(selected);
        }
    };

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
            padding: '1rem'
        }}>
            <div className="glass-panel" style={{ width: '100%', maxWidth: '400px', padding: '2.5rem', display: 'flex', flexDirection: 'column', gap: '2rem', animation: 'fadeIn 0.3s ease-out', background: 'var(--bg-primary)', textAlign: 'center' }}>

                <div>
                    <div style={{ background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-secondary))', width: '64px', height: '64px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.5rem auto' }}>
                        <ShieldAlert size={32} color="white" />
                    </div>
                    <h2 style={{ fontSize: '1.75rem', margin: '0 0 0.5rem 0', color: 'var(--text-primary)' }}>Seleccione su Estación</h2>
                    <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '0.95rem' }}>Debes elegir una estación de trabajo para continuar.</p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <button
                        onClick={() => setSelected('Cocina')}
                        style={{
                            padding: '1.2rem', borderRadius: '12px', border: selected === 'Cocina' ? '2px solid var(--accent-primary)' : '2px solid rgba(255,255,255,0.1)',
                            background: selected === 'Cocina' ? 'rgba(168, 85, 247, 0.1)' : 'var(--bg-secondary)',
                            color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '1rem', cursor: 'pointer', transition: 'all 0.2s', fontSize: '1.1rem', fontWeight: selected === 'Cocina' ? 'bold' : 'normal'
                        }}>
                        <ChefHat size={24} color={selected === 'Cocina' ? 'var(--accent-primary)' : 'var(--text-secondary)'} />
                        Cocina
                    </button>
                    <button
                        onClick={() => setSelected('Salon')}
                        style={{
                            padding: '1.2rem', borderRadius: '12px', border: selected === 'Salon' ? '2px solid var(--accent-secondary)' : '2px solid rgba(255,255,255,0.1)',
                            background: selected === 'Salon' ? 'rgba(56, 189, 248, 0.1)' : 'var(--bg-secondary)',
                            color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '1rem', cursor: 'pointer', transition: 'all 0.2s', fontSize: '1.1rem', fontWeight: selected === 'Salon' ? 'bold' : 'normal'
                        }}>
                        <Coffee size={24} color={selected === 'Salon' ? 'var(--accent-secondary)' : 'var(--text-secondary)'} />
                        Salon
                    </button>
                </div>

                <button
                    onClick={handleConfirm}
                    disabled={!selected}
                    className="btn-primary"
                    style={{ padding: '1rem', borderRadius: '12px', fontSize: '1.1rem', opacity: !selected ? 0.5 : 1, cursor: !selected ? 'not-allowed' : 'pointer', marginTop: '1rem' }}>
                    Confirmar Estación
                </button>
            </div>
        </div>
    );
}
