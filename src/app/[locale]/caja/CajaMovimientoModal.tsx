'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAdmin } from '@/components/AdminContext';
import { createCajaMovimiento } from '@/app/actions/caja';
import SignaturePad, { type SignatureValue } from '@/components/ui/SignaturePad';
import { parseAmount } from './cajaUi';

type Tipo = 'RETIRO' | 'COMPRA' | 'INGRESO';
type Box = 'BLANCA' | 'NEGRA';
type Staff = { id: string; name: string };

const TIPOS: Tipo[] = ['RETIRO', 'COMPRA', 'INGRESO'];
const BOXES: Box[] = ['BLANCA', 'NEGRA'];

/**
 * Cash leaving or entering a box between counts. One type, one box, an
 * amount, what it was for, and the signature of whoever did it — the same
 * signature a count takes. RETIRO is only offered to an admin; the server
 * enforces that again.
 */
export default function CajaMovimientoModal({ staff, onClose, onSaved }: {
    staff: Staff[];
    onClose: () => void;
    onSaved: (movimientoId: string) => void;
}) {
    const t = useTranslations('Caja');
    const { isAdmin } = useAdmin();

    const [tipo, setTipo] = useState<Tipo | null>(null);
    const [caja, setCaja] = useState<Box | null>(null);
    const [amountStr, setAmountStr] = useState('');
    const [descripcion, setDescripcion] = useState('');
    const [signer, setSigner] = useState<Staff | null>(null);
    const [signature, setSignature] = useState<SignatureValue | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const amountCents = parseAmount(amountStr);
    const amountInvalid = amountStr.trim() !== '' && (amountCents === null || amountCents <= 0);
    const canSave = tipo !== null
        && caja !== null
        && amountCents !== null && amountCents > 0
        && descripcion.trim().length > 0
        && signer !== null
        && signature !== null
        && !isSubmitting;

    const handleSave = async () => {
        if (!canSave || !tipo || !caja || amountCents === null || !signer || !signature) return;
        setIsSubmitting(true);
        try {
            const result = await createCajaMovimiento({
                caja, tipo, amountCents,
                descripcion: descripcion.trim(),
                employeeId: signer.id,
                employeeName: signer.name,
                firmaPath: signature.path,
                firmaBox: signature.box,
            });
            if (!result.success || !result.movimientoId) {
                alert(result.errorKey ? t(result.errorKey) : (result.error ?? t('movement_save_failed')));
                return;
            }
            onSaved(result.movimientoId);
        } catch (e) {
            alert(e instanceof Error ? e.message : t('movement_save_failed'));
        } finally {
            setIsSubmitting(false);
        }
    };

    const pill = (label: string, isOn: boolean, onClick: () => void, disabled = false) => (
        <button
            key={label}
            type="button"
            disabled={disabled || isSubmitting}
            onClick={onClick}
            style={{
                padding: '0.8rem 1.3rem', minHeight: '56px',
                borderRadius: '999px', fontSize: '1.1rem', fontWeight: 600,
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.4 : 1,
                color: isOn ? 'white' : 'var(--text-secondary)',
                background: isOn ? 'var(--accent-primary)' : 'rgba(255,255,255,0.05)',
                border: isOn ? '1px solid var(--accent-primary)' : '1px solid var(--border)',
            }}
        >
            {label}
        </button>
    );

    const fieldLabel = (text: string) => (
        <span style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>{text}</span>
    );

    return (
        <div
            onClick={() => { if (!isSubmitting) onClose(); }}
            style={{
                position: 'fixed', inset: 0, zIndex: 1000,
                background: 'rgba(0,0,0,0.5)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '1.5rem'
            }}
        >
            <div
                onClick={e => e.stopPropagation()}
                className="glass-panel"
                style={{ padding: '2rem', maxWidth: '820px', width: '100%', maxHeight: '88vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}
            >
                <h3 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {t('record_MOVIMIENTO')}
                </h3>

                {/* Type */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                    {fieldLabel(t('mov_type_label'))}
                    <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                        {TIPOS.filter(x => x !== 'RETIRO' || isAdmin).map(x =>
                            pill(t(`mov_${x}`), tipo === x, () => setTipo(x))
                        )}
                    </div>
                </div>

                {/* Box */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                    {fieldLabel(t('mov_box_label'))}
                    <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                        {BOXES.map(b => pill(t(`box_${b}`), caja === b, () => setCaja(b)))}
                    </div>
                </div>

                {/* Amount */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    {fieldLabel(t('mov_amount_label'))}
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                        padding: '0 1rem', minHeight: '64px', borderRadius: '12px',
                        background: 'rgba(0,0,0,0.2)',
                        border: amountInvalid ? '1px solid var(--danger)' : '1px solid var(--border)',
                    }}>
                        <span style={{ fontSize: '1.6rem', color: 'var(--text-secondary)' }}>$</span>
                        <input
                            type="text"
                            inputMode="decimal"
                            placeholder="0.00"
                            value={amountStr}
                            disabled={isSubmitting}
                            onChange={e => setAmountStr(e.target.value)}
                            onBlur={() => {
                                const cents = parseAmount(amountStr);
                                if (cents !== null) setAmountStr((cents / 100).toFixed(2));
                            }}
                            style={{
                                flex: 1, minWidth: 0, fontSize: '1.6rem', fontWeight: 600,
                                background: 'transparent', border: 'none', outline: 'none',
                                color: 'var(--text-primary)', minHeight: '56px',
                            }}
                        />
                    </div>
                    {amountInvalid && (
                        <span style={{ fontSize: '0.95rem', color: 'var(--danger)' }}>{t('err_amount_invalid')}</span>
                    )}
                </div>

                {/* Description */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    {fieldLabel(t('mov_desc_label'))}
                    <textarea
                        value={descripcion}
                        disabled={isSubmitting}
                        onChange={e => setDescripcion(e.target.value)}
                        placeholder={tipo ? t(`mov_desc_placeholder_${tipo}`) : ''}
                        rows={2}
                        style={{
                            width: '100%', boxSizing: 'border-box', fontSize: '1.05rem', padding: '0.75rem',
                            borderRadius: '10px', background: 'rgba(0,0,0,0.2)', color: 'var(--text-primary)',
                            border: '1px solid var(--border)', resize: 'vertical',
                        }}
                    />
                </div>

                {/* Signer */}
                <div className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {fieldLabel(t('mov_signer_label'))}
                    <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                        {staff.length === 0 && (
                            <span style={{ color: 'var(--text-secondary)', fontSize: '1rem' }}>{t('no_staff')}</span>
                        )}
                        {staff.map(person =>
                            pill(person.name, signer?.id === person.id, () => {
                                setSigner(signer?.id === person.id ? null : person);
                                setSignature(null);
                            })
                        )}
                    </div>
                    {signer && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                            <SignaturePad
                                key={signer.id}
                                value={signature}
                                onChange={setSignature}
                                disabled={isSubmitting}
                                labels={{ signHere: t('sign_here'), clear: t('clear') }}
                            />
                            <span style={{ fontSize: '0.95rem', color: 'var(--text-secondary)' }}>
                                {t('signature_time_note', { name: signer.name })}
                            </span>
                        </div>
                    )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <button type="button" onClick={onClose} disabled={isSubmitting} className="btn-secondary" style={secondaryBtn}>
                        {t('cancel')}
                    </button>
                    <button type="button" onClick={handleSave} disabled={!canSave} style={primaryBtn(!canSave)}>
                        {isSubmitting ? t('saving') : t('save_movement')}
                    </button>
                </div>
            </div>
        </div>
    );
}

const secondaryBtn: React.CSSProperties = {
    minHeight: '56px', padding: '0.9rem 1.4rem', borderRadius: '8px',
    fontSize: '1.1rem', fontWeight: 600, cursor: 'pointer',
    background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)',
    color: 'var(--text-primary)',
};

const primaryBtn = (disabled: boolean): React.CSSProperties => ({
    minHeight: '56px', padding: '0.9rem 1.6rem', borderRadius: '8px',
    fontSize: '1.1rem', fontWeight: 700, cursor: disabled ? 'default' : 'pointer',
    background: 'var(--accent-primary)', border: '1px solid var(--accent-primary)',
    color: 'white', opacity: disabled ? 0.5 : 1,
});
