'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { toPng } from 'html-to-image';
import { useAdmin } from '@/components/AdminContext';
import { createCajaMovimiento, getCajaEsperado, type CajaEsperadoResult } from '@/app/actions/caja';
import { formatMoney } from '@/lib/money';
import { businessDateToUtcDate, formatBusinessDateEs } from '@/lib/businessDay';
import SignaturePad, { type SignatureValue } from '@/components/ui/SignaturePad';
import SenderPicker, { senderDisplayNames } from '@/components/ui/SenderPicker';
import CajaMovimientoCapture, { type ShareMovimientoData } from './CajaMovimientoCapture';
import { parseAmount } from './cajaUi';

type Tipo = 'RETIRO' | 'COMPRA' | 'INGRESO';
type Box = 'BLANCA' | 'NEGRA';
type Staff = { id: string; name: string };
type RetiroMode = 'amount' | 'remaining';
type EsperadoOk = Extract<CajaEsperadoResult, { success: true }>;
type Esperado =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'error' }
    | { status: 'ready'; data: EsperadoOk };

const TIPOS: Tipo[] = ['RETIRO', 'COMPRA', 'INGRESO'];
const BOXES: Box[] = ['BLANCA', 'NEGRA'];

/** What Clover says should be in `caja` right now, or null without a float yet. */
function expectedFor(caja: Box, data: EsperadoOk): number | null {
    return caja === 'BLANCA' ? data.blanca.esperadoCents : data.negra.referenciaCents;
}

/**
 * Cash leaving or entering a box between counts. One type, one box, an
 * amount, what it was for, and the signature of whoever did it — the same
 * signature a count takes. RETIRO is only offered to an admin; the server
 * enforces that again.
 */
export default function CajaMovimientoModal({ staff, businessDate, onClose, onSaved }: {
    staff: Staff[];
    /** For the save-and-share preview: today's date, for the capture's title and filename. */
    businessDate: string;
    onClose: () => void;
    onSaved: (movimientoId: string) => void;
}) {
    const t = useTranslations('Caja');
    const { isAdmin } = useAdmin();

    const [tipo, setTipo] = useState<Tipo | null>(null);
    const [caja, setCaja] = useState<Box | null>(null);
    const [amountStr, setAmountStr] = useState('');
    const [remainingStr, setRemainingStr] = useState('');
    const [retiroMode, setRetiroMode] = useState<RetiroMode>('amount');
    const [esperado, setEsperado] = useState<Esperado>({ status: 'idle' });
    const [descripcion, setDescripcion] = useState('');
    const [signer, setSigner] = useState<Staff | null>(null);
    const [signature, setSignature] = useState<SignatureValue | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Who sends the share, and the PNG built ahead of the tap so the share
    // sheet can open from the tap's own user activation.
    const [sender, setSender] = useState<Staff | null>(null);
    const [shareFile, setShareFile] = useState<File | null>(null);
    // Set only when the movement WAS shared but the save came back failed —
    // the person has to know the message went out against nothing.
    const [sharedButNotSaved, setSharedButNotSaved] = useState(false);
    const captureRef = useRef<HTMLDivElement>(null);
    const genTokenRef = useRef(0);

    // Fetched once, the moment any type is picked — both boxes come back in
    // the one call, so a later box or type switch never needs a second
    // round-trip. RETIRO's "left in the box" mode needs it to convert; every
    // type needs it for the capture's "should be in the box now" line.
    useEffect(() => {
        if (tipo === null || esperado.status !== 'idle') return;
        setEsperado({ status: 'loading' });
        getCajaEsperado()
            .then(r => setEsperado(r.success ? { status: 'ready', data: r } : { status: 'error' }))
            .catch(() => setEsperado({ status: 'error' }));
    }, [tipo, esperado.status]);

    const expectedCents = caja !== null && esperado.status === 'ready' ? expectedFor(caja, esperado.data) : null;
    const remainingUnavailableReason =
        caja === null ? t('mov_choose_box_first')
            : esperado.status === 'loading' ? t('checking_clover')
                : esperado.status === 'error' ? t('clover_unavailable')
                    : expectedCents === null ? t('mov_no_float_yet')
                        : null;
    const remainingAvailable = remainingUnavailableReason === null;

    const handleRetiroModeChange = (next: RetiroMode) => {
        if (next === retiroMode) return;
        if (expectedCents !== null) {
            if (next === 'remaining') {
                const amt = parseAmount(amountStr);
                if (amt !== null) setRemainingStr(((expectedCents - amt) / 100).toFixed(2));
            } else {
                const rem = parseAmount(remainingStr);
                if (rem !== null) setAmountStr(((expectedCents - rem) / 100).toFixed(2));
            }
        }
        setRetiroMode(next);
    };

    const typedAmountCents = parseAmount(amountStr);
    const typedRemainingCents = parseAmount(remainingStr);
    const usesRemaining = tipo === 'RETIRO' && retiroMode === 'remaining';

    let amountCents: number | null;
    let remainingError: string | null = null;
    if (usesRemaining) {
        amountCents = null;
        if (expectedCents !== null && typedRemainingCents !== null) {
            if (typedRemainingCents > expectedCents) remainingError = t('mov_remaining_too_high');
            else if (typedRemainingCents === expectedCents) remainingError = t('mov_remaining_equal');
            else amountCents = expectedCents - typedRemainingCents;
        }
    } else {
        amountCents = typedAmountCents;
    }

    const amountInvalid = !usesRemaining && amountStr.trim() !== '' && (amountCents === null || amountCents <= 0);
    const remainingInvalid = usesRemaining && remainingStr.trim() !== '' && typedRemainingCents === null;

    // Every field the record needs, independent of the sender and of
    // isSubmitting — this is also exactly what the capture is ready to be
    // built from, so it is not re-gated separately below.
    const readyToSave = tipo !== null
        && caja !== null
        && amountCents !== null && amountCents > 0
        && (!usesRemaining || remainingAvailable)
        && descripcion.trim().length > 0
        && signer !== null
        && signature !== null;
    const canSave = readyToSave && sender !== null && !isSubmitting;
    const showCaptureSurface = readyToSave && sender !== null;

    const names = senderDisplayNames(staff);
    const senderLabel = sender ? (names.get(sender.id) ?? sender.name) : '';
    const fechaLarga = formatBusinessDateEs(businessDateToUtcDate(businessDate));

    // The movement's own sign, so "expected after" reflects what this record
    // will do to the box: INGRESO adds, RETIRO and COMPRA subtract.
    const movSignedAmount = amountCents !== null ? (tipo === 'INGRESO' ? amountCents : -amountCents) : null;
    const expectedAfterCents = expectedCents !== null && movSignedAmount !== null ? expectedCents + movSignedAmount : null;

    const previewMovData: ShareMovimientoData | null = useMemo(() => {
        if (!showCaptureSurface || tipo === null || caja === null || amountCents === null || !signer || !signature) return null;
        return {
            tipo, caja, amountCents,
            descripcion: descripcion.trim(),
            expectedAfterCents,
            firma: { employeeName: signer.name, firmaPath: signature.path, firmaBox: signature.box, signedAt: new Date() },
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showCaptureSurface, tipo, caja, amountCents, descripcion, signer, signature, expectedAfterCents]);

    // Regenerated whenever an input that appears in the capture changes. The
    // effect runs after the DOM has committed the new previewMovData, so the
    // offscreen node already reflects it by the time toPng reads it.
    useEffect(() => {
        if (!previewMovData) { setShareFile(null); return; }
        const token = ++genTokenRef.current;
        setShareFile(null);
        (async () => {
            if (!captureRef.current) return;
            try {
                const dataUrl = await toPng(captureRef.current, { pixelRatio: 2, backgroundColor: '#ffffff', cacheBust: true });
                if (genTokenRef.current !== token) return;
                const blob = await (await fetch(dataUrl)).blob();
                if (genTokenRef.current !== token) return;
                setShareFile(new File([blob], `movimiento-caja-${businessDate}.png`, { type: 'image/png' }));
            } catch {
                if (genTokenRef.current === token) setShareFile(null);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [previewMovData, senderLabel, businessDate]);

    /**
     * The one-button flow. iOS Safari refuses navigator.share unless it runs
     * from the tap's own user activation, so nothing may be awaited before
     * it: the save starts and is held as a promise, the share fires
     * immediately after with the File already built, and only then is the
     * save promise awaited. There is no path that saves without sharing.
     */
    const handleSaveAndShare = async () => {
        if (!canSave || !tipo || !caja || amountCents === null || !signer || !signature || !shareFile) return;
        setIsSubmitting(true);
        setSharedButNotSaved(false);

        const savePromise = createCajaMovimiento({
            caja, tipo, amountCents,
            descripcion: descripcion.trim(),
            employeeId: signer.id,
            employeeName: signer.name,
            firmaPath: signature.path,
            firmaBox: signature.box,
        });

        let shared = false;
        try {
            if (navigator.canShare && navigator.canShare({ files: [shareFile] })) {
                await navigator.share({ files: [shareFile], title: `Movimiento de Caja — ${fechaLarga}` });
                shared = true;
            }
        } catch {
            // AbortError = the sheet was dismissed; any other share error is
            // treated the same way — the save is still the source of truth.
        }

        try {
            const result = await savePromise;
            if (!result.success || !result.movimientoId) {
                if (shared) { setSharedButNotSaved(true); return; }
                alert(result.errorKey ? t(result.errorKey) : (result.error ?? t('movement_save_failed')));
                return;
            }
            // Nothing to mark: CajaMovimiento keeps no shareAttemptedAt field.
            onSaved(result.movimientoId);
        } catch (e) {
            if (shared) setSharedButNotSaved(true);
            else alert(e instanceof Error ? e.message : t('movement_save_failed'));
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
                    {tipo === 'RETIRO' && (
                        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.2rem' }}>
                            {pill(t('mov_retiro_mode_amount'), retiroMode === 'amount', () => handleRetiroModeChange('amount'))}
                            {pill(
                                t('mov_retiro_mode_remaining'), retiroMode === 'remaining',
                                () => handleRetiroModeChange('remaining'),
                                !remainingAvailable,
                            )}
                        </div>
                    )}
                    {tipo === 'RETIRO' && retiroMode === 'remaining' && !remainingAvailable && (
                        <span style={{ fontSize: '0.95rem', color: 'var(--text-secondary)' }}>{remainingUnavailableReason}</span>
                    )}

                    {fieldLabel(usesRemaining ? t('mov_remaining_amount_label') : t('mov_amount_label'))}
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: '0.5rem',
                        padding: '0 1rem', minHeight: '64px', borderRadius: '12px',
                        background: 'rgba(0,0,0,0.2)',
                        border: (usesRemaining ? remainingInvalid || remainingError !== null : amountInvalid)
                            ? '1px solid var(--danger)' : '1px solid var(--border)',
                    }}>
                        <span style={{ fontSize: '1.6rem', color: 'var(--text-secondary)' }}>$</span>
                        {usesRemaining ? (
                            <input
                                type="text"
                                inputMode="decimal"
                                placeholder="0.00"
                                value={remainingStr}
                                disabled={isSubmitting}
                                onChange={e => setRemainingStr(e.target.value)}
                                onBlur={() => {
                                    const cents = parseAmount(remainingStr);
                                    if (cents !== null) setRemainingStr((cents / 100).toFixed(2));
                                }}
                                style={{
                                    flex: 1, minWidth: 0, fontSize: '1.6rem', fontWeight: 600,
                                    background: 'transparent', border: 'none', outline: 'none',
                                    color: 'var(--text-primary)', minHeight: '56px',
                                }}
                            />
                        ) : (
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
                        )}
                    </div>
                    {tipo === 'RETIRO' && caja !== null && expectedCents !== null && (
                        <span style={{ fontSize: '0.95rem', color: 'var(--text-secondary)' }}>
                            {t('mov_should_have_now', { amount: formatMoney(expectedCents) })}
                        </span>
                    )}
                    {usesRemaining && remainingError && (
                        <span style={{ fontSize: '0.95rem', color: 'var(--danger)' }}>{remainingError}</span>
                    )}
                    {usesRemaining && !remainingError && remainingInvalid && (
                        <span style={{ fontSize: '0.95rem', color: 'var(--danger)' }}>{t('err_amount_invalid')}</span>
                    )}
                    {usesRemaining && !remainingError && amountCents !== null && (
                        <span style={{ fontSize: '0.95rem', color: 'var(--text-secondary)' }}>
                            {t('mov_will_record', { amount: formatMoney(amountCents) })}
                        </span>
                    )}
                    {!usesRemaining && amountInvalid && (
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

                <SenderPicker staff={staff} value={sender} onChange={setSender} label={t('share_who')} />

                {sharedButNotSaved && (
                    <div style={{
                        padding: '1rem 1.25rem', borderRadius: '10px', fontSize: '1.05rem', fontWeight: 600,
                        color: 'var(--danger)', background: 'color-mix(in srgb, var(--danger) 12%, transparent)',
                        border: '1px solid color-mix(in srgb, var(--danger) 40%, transparent)',
                    }}>
                        {t('share_but_not_saved')}
                    </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <button type="button" onClick={onClose} disabled={isSubmitting} className="btn-secondary" style={secondaryBtn}>
                        {t('cancel')}
                    </button>
                    <button
                        type="button"
                        onClick={handleSaveAndShare}
                        disabled={!canSave || !shareFile}
                        style={primaryBtn(!canSave || !shareFile)}
                    >
                        {isSubmitting ? t('saving') : !shareFile && canSave ? t('preparing') : t('save_and_share')}
                    </button>
                </div>
            </div>

            {/* Offscreen capture surface for the save-and-share preview — not
                display:none, which html-to-image cannot render. */}
            {previewMovData && (
                <div style={{ position: 'fixed', left: '-10000px', top: 0, pointerEvents: 'none' }} aria-hidden="true">
                    <CajaMovimientoCapture
                        captureRef={captureRef}
                        businessDate={businessDate}
                        data={previewMovData}
                        senderLabel={senderLabel}
                    />
                </div>
            )}
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
