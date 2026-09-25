'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { toPng } from 'html-to-image';
import { getCajaEsperado, createCajaCorte, marcarCajaCompartido, type CajaEsperadoResult } from '@/app/actions/caja';
import { TOLERANCIA_CENTS, nivelFor } from '@/lib/cajaRules';
import { formatMoney } from '@/lib/money';
import { businessDateToUtcDate, formatBusinessDateEs } from '@/lib/businessDay';
import SignaturePad, { type SignatureValue } from '@/components/ui/SignaturePad';
import SenderPicker, { senderDisplayNames } from '@/components/ui/SenderPicker';
import CajaShareCapture, { type ShareCorteData, type ShareMovData } from './CajaShareCapture';
import { NivelBadge, SinVerificar, PosibleTraslado, signedMoney, parseAmount } from './cajaUi';

type Tipo = 'APERTURA' | 'RELEVO' | 'CIERRE';
type Rol = 'APERTURA' | 'SALIENTE' | 'ENTRANTE' | 'CIERRE';
type Box = 'BLANCA' | 'NEGRA';
type Staff = { id: string; name: string };

type EsperadoOk = Extract<CajaEsperadoResult, { success: true }>;

/** Who signs a corte of each type, in the order the blocks appear. */
const SIGNERS: Record<Tipo, Rol[]> = {
    APERTURA: ['APERTURA'],
    RELEVO: ['SALIENTE', 'ENTRANTE'],
    CIERRE: ['CIERRE'],
};

/** The captured content is always Spanish; only the modal chrome is translated. */
const TITULO: Record<Tipo, string> = { APERTURA: 'Apertura de Caja', RELEVO: 'Relevo de Caja', CIERRE: 'Cierre de Caja' };
const FILE_PREFIX: Record<Tipo, string> = { APERTURA: 'apertura-caja', RELEVO: 'relevo-caja', CIERRE: 'cierre-caja' };

type Comparison =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'error' }
    | { status: 'ready'; data: EsperadoOk };

/**
 * The corte form. The count is blind: nothing from Clover is shown until
 * both boxes are typed and "Compare" is tapped, and at that point the
 * amounts lock so the comparison and the count stay the same numbers.
 */
export default function CajaCorteModal({ tipo, staff, businessDate, nextSeq, movimientos, onClose, onSaved }: {
    tipo: Tipo;
    staff: Staff[];
    /** For the save-and-share preview: today's date and live movements. */
    businessDate: string;
    /** Best-known seq this corte will get, for the preview only — cosmetic. */
    nextSeq: number;
    movimientos: ShareMovData[];
    onClose: () => void;
    onSaved: (corteId: string) => void;
}) {
    const t = useTranslations('Caja');

    const [blancaStr, setBlancaStr] = useState('');
    const [negraStr, setNegraStr] = useState('');
    const [tabsConfirmadas, setTabsConfirmadas] = useState(false);
    const [comparison, setComparison] = useState<Comparison>({ status: 'idle' });
    const [motivos, setMotivos] = useState<Record<Box, string>>({ BLANCA: '', NEGRA: '' });
    const [signers, setSigners] = useState<Partial<Record<Rol, Staff>>>({});
    const [signatures, setSignatures] = useState<Partial<Record<Rol, SignatureValue | null>>>({});
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Every tipo shares on save now: who sends it, and the PNG built ahead of
    // the tap so the share sheet can open from the tap's own user activation.
    const [sender, setSender] = useState<Staff | null>(null);
    const [shareFile, setShareFile] = useState<File | null>(null);
    // Set only when the closing WAS shared but the save came back failed —
    // the person has to know the message went out against nothing.
    const [sharedButNotSaved, setSharedButNotSaved] = useState(false);
    const captureRef = useRef<HTMLDivElement>(null);
    const genTokenRef = useRef(0);

    const blancaCents = parseAmount(blancaStr);
    const negraCents = parseAmount(negraStr);
    const countsValid = blancaCents !== null && negraCents !== null;
    const needsComparison = tipo !== 'APERTURA';
    const inputsLocked = comparison.status !== 'idle';
    const busy = isSubmitting || comparison.status === 'loading';

    // ── Judgement, mirrored from createCajaCorte so the client blocks what the
    // server would reject rather than learning it from an alert.
    const data = comparison.status === 'ready' ? comparison.data : null;
    const blancaEsperado = data?.blanca.esperadoCents ?? null;
    const blancaDiff = data && blancaEsperado !== null && blancaCents !== null ? blancaCents - blancaEsperado : null;
    const blancaNivel = blancaDiff === null ? null : nivelFor(blancaDiff, TOLERANCIA_CENTS);

    const negraFirm = tipo === 'CIERRE';
    const negraEsperado = data?.negra.referenciaCents ?? null;
    const negraDiff = negraFirm && data && negraEsperado !== null && negraCents !== null ? negraCents - negraEsperado : null;
    const negraNivel = negraDiff === null ? null : nivelFor(negraDiff, TOLERANCIA_CENTS);

    const totalDiff = blancaDiff !== null && negraDiff !== null ? blancaDiff + negraDiff : null;
    const totalNivel = totalDiff === null ? null : nivelFor(totalDiff, TOLERANCIA_CENTS);
    const posibleTraslado = totalDiff !== null
        && Math.abs(totalDiff) <= TOLERANCIA_CENTS
        && (blancaNivel === 'DESCUADRE' || negraNivel === 'DESCUADRE');

    const sinApertura = data !== null && (blancaEsperado === null || (negraFirm && negraEsperado === null));

    const motivoRequired: Record<Box, boolean> = {
        BLANCA: blancaNivel === 'DESCUADRE',
        NEGRA: negraNivel === 'DESCUADRE',
    };
    const motivosOk = (['BLANCA', 'NEGRA'] as Box[]).every(b => !motivoRequired[b] || motivos[b].trim().length > 0);

    const signersOk = SIGNERS[tipo].every(rol => signers[rol] && signatures[rol]);

    const canCompare = countsValid && (tipo !== 'CIERRE' || tabsConfirmadas) && !busy;
    const canSave = countsValid
        && (!needsComparison || (comparison.status === 'ready' && !sinApertura))
        && motivosOk
        && signersOk
        && sender !== null
        && !busy;

    // ── Save-and-share preview, every tipo. Built the moment the count is
    // complete for that tipo — APERTURA has no comparison to wait on, so its
    // count alone is enough — and every signature is present, so the PNG is
    // ready before the tap that needs it: iOS refuses a share sheet chained
    // onto a save.
    const countComplete = tipo === 'APERTURA' ? countsValid : (comparison.status === 'ready' && !sinApertura);
    const showCaptureSurface = countComplete && signersOk;

    const names = senderDisplayNames(staff);
    const senderLabel = sender ? (names.get(sender.id) ?? sender.name) : '';
    const fechaLarga = formatBusinessDateEs(businessDateToUtcDate(businessDate));

    const previewData: ShareCorteData | null = useMemo(() => {
        if (!showCaptureSurface || blancaCents === null || negraCents === null) return null;
        return {
            tipo,
            seq: nextSeq,
            at: new Date(),
            lineas: [
                {
                    id: 'BLANCA', caja: 'BLANCA', contadoCents: blancaCents,
                    esperadoCents: blancaEsperado, esEstimado: false, referenciaCents: null,
                    nivel: blancaNivel, diffCents: blancaDiff,
                    motivo: motivos.BLANCA.trim() || null, movimientosCents: data?.movimientos.BLANCA ?? null,
                },
                {
                    id: 'NEGRA', caja: 'NEGRA', contadoCents: negraCents,
                    esperadoCents: negraEsperado, esEstimado: !negraFirm, referenciaCents: negraEsperado,
                    nivel: negraNivel, diffCents: negraDiff,
                    motivo: motivos.NEGRA.trim() || null, movimientosCents: data?.movimientos.NEGRA ?? null,
                },
            ],
            totalDiffCents: totalDiff,
            totalNivel,
            posibleTraslado,
            firmas: SIGNERS[tipo].map(rol => {
                const who = signers[rol]!;
                const sig = signatures[rol]!;
                return { id: rol, rol, employeeName: who.name, firmaPath: sig.path, firmaBox: sig.box, signedAt: new Date() };
            }),
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        showCaptureSurface, blancaCents, negraCents, blancaEsperado, blancaDiff, blancaNivel,
        negraEsperado, negraDiff, negraNivel, totalDiff, totalNivel, posibleTraslado,
        motivos, signers, signatures, nextSeq, tipo, data,
    ]);

    // Regenerated whenever an input that appears in the capture changes. The
    // effect runs after the DOM has committed the new previewData, so the
    // offscreen node already reflects it by the time toPng reads it.
    useEffect(() => {
        if (!previewData) { setShareFile(null); return; }
        const token = ++genTokenRef.current;
        setShareFile(null);
        (async () => {
            if (!captureRef.current) return;
            try {
                const dataUrl = await toPng(captureRef.current, { pixelRatio: 2, backgroundColor: '#ffffff', cacheBust: true });
                if (genTokenRef.current !== token) return;
                const blob = await (await fetch(dataUrl)).blob();
                if (genTokenRef.current !== token) return;
                setShareFile(new File([blob], `${FILE_PREFIX[tipo]}-${businessDate}.png`, { type: 'image/png' }));
            } catch {
                if (genTokenRef.current === token) setShareFile(null);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [previewData, senderLabel, businessDate]);

    const runComparison = async () => {
        setComparison({ status: 'loading' });
        try {
            const r = await getCajaEsperado();
            setComparison(r.success ? { status: 'ready', data: r } : { status: 'error' });
        } catch {
            setComparison({ status: 'error' });
        }
    };

    const unlock = () => {
        setComparison({ status: 'idle' });
        setMotivos({ BLANCA: '', NEGRA: '' });
    };

    const buildCorteInput = () => {
        if (blancaCents === null || negraCents === null) return null;
        return {
            tipo,
            lineas: [
                { caja: 'BLANCA' as const, contadoCents: blancaCents, motivo: motivos.BLANCA.trim() || undefined },
                { caja: 'NEGRA' as const, contadoCents: negraCents, motivo: motivos.NEGRA.trim() || undefined },
            ],
            firmas: SIGNERS[tipo].map(rol => {
                const who = signers[rol]!;
                const sig = signatures[rol]!;
                return { rol, employeeId: who.id, employeeName: who.name, firmaPath: sig.path, firmaBox: sig.box };
            }),
            tabsConfirmadas: tipo === 'CIERRE' ? tabsConfirmadas : undefined,
            notas: undefined,
        };
    };

    /**
     * The one-button flow, every tipo. iOS Safari refuses navigator.share
     * unless it runs from the tap's own user activation, so nothing may be
     * awaited before it: the save starts and is held as a promise, the share
     * fires immediately after with the File already built, and only then is
     * the save promise awaited. There is no path that saves without sharing.
     */
    const handleSaveAndShare = async () => {
        const input = buildCorteInput();
        if (!canSave || !input || !shareFile) return;
        setIsSubmitting(true);
        setSharedButNotSaved(false);

        const savePromise = createCajaCorte(input);

        let shared = false;
        try {
            if (navigator.canShare && navigator.canShare({ files: [shareFile] })) {
                await navigator.share({ files: [shareFile], title: `${TITULO[tipo]} — ${fechaLarga}` });
                shared = true;
            }
        } catch {
            // AbortError = the sheet was dismissed; any other share error is
            // treated the same way — the save is still the source of truth.
        }

        try {
            const result = await savePromise;
            if (!result.success || !result.corteId) {
                if (shared) { setSharedButNotSaved(true); return; }
                alert(result.errorKey ? t(result.errorKey) : (result.error ?? t('save_failed')));
                return;
            }
            if (shared) void marcarCajaCompartido(result.corteId);
            onSaved(result.corteId);
        } catch (e) {
            if (shared) setSharedButNotSaved(true);
            else alert(e instanceof Error ? e.message : t('save_failed'));
        } finally {
            setIsSubmitting(false);
        }
    };

    // ── Pieces ───────────────────────────────────────────────────────────────

    const padLabels = { signHere: t('sign_here'), clear: t('clear') };

    const moneyInput = (caja: Box, value: string, setValue: (v: string) => void) => {
        const invalid = value.trim() !== '' && parseAmount(value) === null;
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <label style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {t(`box_${caja}`)}
                </label>
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    padding: '0 1rem', minHeight: '64px', borderRadius: '12px',
                    background: 'rgba(0,0,0,0.2)',
                    border: invalid ? '1px solid var(--danger)' : '1px solid var(--border)',
                    opacity: inputsLocked ? 0.7 : 1,
                }}>
                    <span style={{ fontSize: '1.6rem', color: 'var(--text-secondary)' }}>$</span>
                    <input
                        type="text"
                        inputMode="decimal"
                        placeholder="0.00"
                        value={value}
                        disabled={inputsLocked || busy}
                        onChange={e => setValue(e.target.value)}
                        onBlur={() => {
                            const cents = parseAmount(value);
                            if (cents !== null) setValue((cents / 100).toFixed(2));
                        }}
                        style={{
                            flex: 1, minWidth: 0, fontSize: '1.6rem', fontWeight: 600,
                            background: 'transparent', border: 'none', outline: 'none',
                            color: 'var(--text-primary)', minHeight: '56px',
                        }}
                    />
                </div>
                <span style={{ fontSize: '0.95rem', color: invalid ? 'var(--danger)' : 'var(--text-secondary)' }}>
                    {invalid ? t('invalid_amount') : t(`hint_${caja}`)}
                </span>
            </div>
        );
    };

    const compareRow = (label: string, contado: number, esperado: number | null, badge: React.ReactNode, note?: React.ReactNode) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '1rem 0', borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{label}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', alignItems: 'center' }}>
                <div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('col_counted')}</div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-primary)' }}>{formatMoney(contado)}</div>
                </div>
                <div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('col_expected')}</div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {esperado === null ? '—' : formatMoney(esperado)}
                    </div>
                </div>
                <div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{t('col_difference')}</div>
                    <div style={{ marginTop: '0.2rem' }}>{badge}</div>
                </div>
            </div>
            {note}
        </div>
    );

    const motivoField = (caja: Box, required: boolean) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <label style={{ fontSize: '1rem', fontWeight: 600, color: required ? 'var(--danger)' : 'var(--text-secondary)' }}>
                {required ? t('reason_required') : t('reason_optional')}
            </label>
            <textarea
                value={motivos[caja]}
                disabled={busy}
                onChange={e => setMotivos(prev => ({ ...prev, [caja]: e.target.value }))}
                rows={2}
                style={{
                    width: '100%', boxSizing: 'border-box', fontSize: '1.05rem', padding: '0.75rem',
                    borderRadius: '10px', background: 'rgba(0,0,0,0.2)', color: 'var(--text-primary)',
                    border: required && !motivos[caja].trim() ? '1px solid var(--danger)' : '1px solid var(--border)',
                    resize: 'vertical',
                }}
            />
        </div>
    );

    const renderComparison = () => {
        if (comparison.status === 'loading') {
            return <p style={{ margin: 0, fontSize: '1.05rem', color: 'var(--text-secondary)' }}>{t('checking_clover')}</p>;
        }
        if (comparison.status === 'error') {
            return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <p style={{ margin: 0, fontSize: '1.05rem', color: 'var(--danger)' }}>{t('clover_unavailable_retry')}</p>
                    <button type="button" onClick={runComparison} className="btn-secondary" style={secondaryBtn}>
                        {t('retry')}
                    </button>
                </div>
            );
        }
        if (comparison.status !== 'ready' || blancaCents === null || negraCents === null) return null;
        const d = comparison.data;

        if (sinApertura) {
            return <p style={{ margin: 0, fontSize: '1.05rem', color: 'var(--danger)' }}>{t('no_opening')}</p>;
        }

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                {compareRow(
                    t('box_BLANCA'), blancaCents, blancaEsperado,
                    blancaNivel !== null && blancaDiff !== null ? <NivelBadge nivel={blancaNivel} diffCents={blancaDiff} /> : null,
                    blancaNivel === 'DESCUADRE' || blancaNivel === 'MENOR' ? motivoField('BLANCA', blancaNivel === 'DESCUADRE') : undefined,
                )}

                {negraFirm
                    ? compareRow(
                        t('box_NEGRA'), negraCents, negraEsperado,
                        negraNivel !== null && negraDiff !== null ? <NivelBadge nivel={negraNivel} diffCents={negraDiff} /> : null,
                        negraNivel === 'DESCUADRE' || negraNivel === 'MENOR' ? motivoField('NEGRA', negraNivel === 'DESCUADRE') : undefined,
                    )
                    : compareRow(
                        t('box_NEGRA'), negraCents, null,
                        <SinVerificar />,
                        <p style={{ margin: 0, fontSize: '0.95rem', color: 'var(--text-secondary)' }}>
                            {t('negra_reference', {
                                amount: negraEsperado === null ? '—' : formatMoney(negraEsperado),
                                count: d.negra.abiertasCount,
                            })}
                        </p>,
                    )}

                {negraFirm && totalDiff !== null && totalNivel !== null && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', padding: '1rem 0', borderTop: '1px solid var(--border)' }}>
                        <span style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{t('total')}</span>
                        <span style={{ fontSize: '1.1rem', color: 'var(--text-secondary)' }}>{signedMoney(totalDiff)}</span>
                        <NivelBadge nivel={totalNivel} diffCents={totalDiff} />
                        {posibleTraslado && <PosibleTraslado />}
                    </div>
                )}

                {d.negra.pendientesCount > 0 && (
                    <p style={{ margin: 0, padding: '0.75rem 1rem', borderRadius: '10px', background: '#fef3c7', color: '#92400e', fontSize: '0.95rem' }}>
                        {t('pendientes_note', { count: d.negra.pendientesCount, amount: formatMoney(d.negra.pendientesCents) })}
                    </p>
                )}

                {d.truncated && (
                    <p style={{ margin: 0, fontSize: '0.95rem', color: 'var(--text-secondary)' }}>{t('truncated_note')}</p>
                )}
            </div>
        );
    };

    const signerBlock = (rol: Rol) => {
        const chosen = signers[rol] ?? null;
        // In a shift change the same person cannot both hand over and receive.
        const takenElsewhere = new Set(
            SIGNERS[tipo].filter(o => o !== rol).map(o => signers[o]?.id).filter(Boolean)
        );
        return (
            <div key={rol} className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <span style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{t(`signer_${rol}`)}</span>
                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                    {staff.length === 0 && (
                        <span style={{ color: 'var(--text-secondary)', fontSize: '1rem' }}>{t('no_staff')}</span>
                    )}
                    {staff.map(person => {
                        const isOn = chosen?.id === person.id;
                        const taken = takenElsewhere.has(person.id);
                        return (
                            <button
                                key={person.id}
                                type="button"
                                disabled={taken || busy}
                                onClick={() => {
                                    setSigners(prev => ({ ...prev, [rol]: isOn ? undefined : person }));
                                    setSignatures(prev => ({ ...prev, [rol]: null }));
                                }}
                                style={{
                                    padding: '0.8rem 1.3rem', minHeight: '56px',
                                    borderRadius: '999px', fontSize: '1.1rem', fontWeight: 600,
                                    cursor: taken ? 'not-allowed' : 'pointer',
                                    opacity: taken ? 0.4 : 1,
                                    color: isOn ? 'white' : 'var(--text-secondary)',
                                    background: isOn ? 'var(--accent-primary)' : 'rgba(255,255,255,0.05)',
                                    border: isOn ? '1px solid var(--accent-primary)' : '1px solid var(--border)',
                                }}
                            >
                                {person.name}
                            </button>
                        );
                    })}
                </div>
                {chosen && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        <SignaturePad
                            key={chosen.id}
                            value={signatures[rol] ?? null}
                            onChange={v => setSignatures(prev => ({ ...prev, [rol]: v }))}
                            disabled={busy}
                            labels={padLabels}
                        />
                        <span style={{ fontSize: '0.95rem', color: 'var(--text-secondary)' }}>
                            {t('signature_time_note', { name: chosen.name })}
                        </span>
                    </div>
                )}
            </div>
        );
    };

    const sectionTitle = (text: string) => (
        <h4 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: 'var(--accent-primary)' }}>{text}</h4>
    );

    return (
        <div
            onClick={() => { if (!busy) onClose(); }}
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
                    {t(`record_${tipo}`)}
                </h3>

                {/* 1 — Count */}
                <section style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {sectionTitle(t('section_count'))}
                    {moneyInput('BLANCA', blancaStr, setBlancaStr)}
                    {moneyInput('NEGRA', negraStr, setNegraStr)}

                    {tipo === 'CIERRE' && (
                        <label style={{
                            display: 'flex', alignItems: 'center', gap: '0.9rem', padding: '1rem 1.1rem',
                            borderRadius: '12px', border: '1px solid var(--border)', background: 'rgba(255,255,255,0.03)',
                            cursor: inputsLocked ? 'default' : 'pointer', minHeight: '64px',
                        }}>
                            <input
                                type="checkbox"
                                checked={tabsConfirmadas}
                                disabled={inputsLocked || busy}
                                onChange={e => setTabsConfirmadas(e.target.checked)}
                                style={{ width: '28px', height: '28px', flexShrink: 0 }}
                            />
                            <span style={{ fontSize: '1.05rem', color: 'var(--text-primary)' }}>{t('confirm_tabs')}</span>
                        </label>
                    )}

                    {needsComparison && (
                        inputsLocked ? (
                            <button type="button" onClick={unlock} disabled={busy} className="btn-secondary" style={secondaryBtn}>
                                {t('edit_amounts')}
                            </button>
                        ) : (
                            <button type="button" onClick={runComparison} disabled={!canCompare} style={primaryBtn(!canCompare)}>
                                {t('compare')}
                            </button>
                        )
                    )}
                </section>

                {/* 2 — Comparison */}
                {needsComparison && comparison.status !== 'idle' && (
                    <section style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        {sectionTitle(t('section_compare'))}
                        {renderComparison()}
                    </section>
                )}

                {/* 3 — Signatures */}
                <section style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {sectionTitle(t('section_signatures'))}
                    {SIGNERS[tipo].map(signerBlock)}
                    <SenderPicker staff={staff} value={sender} onChange={setSender} label={t('share_who')} />
                </section>

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
                    <button type="button" onClick={onClose} disabled={busy} className="btn-secondary" style={secondaryBtn}>
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
            {previewData && (
                <div style={{ position: 'fixed', left: '-10000px', top: 0, pointerEvents: 'none' }} aria-hidden="true">
                    <CajaShareCapture
                        captureRef={captureRef}
                        businessDate={businessDate}
                        data={previewData}
                        movimientos={movimientos}
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
