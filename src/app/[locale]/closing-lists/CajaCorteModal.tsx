'use client';

import { useState } from 'react';
import { getCajaEsperado, createCajaCorte, type CajaEsperadoResult } from '@/app/actions/caja';
import { TOLERANCIA_CENTS, nivelFor, CAJA_LABELS } from '@/lib/cajaRules';
import { toCents, formatMoney } from '@/lib/money';
import SignaturePad, { type SignatureValue } from '@/components/ui/SignaturePad';
import { NivelBadge, SinVerificar, PosibleTraslado, signedMoney } from './cajaUi';

type Tipo = 'APERTURA' | 'RELEVO' | 'CIERRE';
type Rol = 'APERTURA' | 'SALIENTE' | 'ENTRANTE' | 'CIERRE';
type Box = 'BLANCA' | 'NEGRA';
type Staff = { id: string; name: string };

type EsperadoOk = Extract<CajaEsperadoResult, { success: true }>;

const TITLES: Record<Tipo, string> = {
    APERTURA: 'Registrar Apertura', RELEVO: 'Registrar Relevo', CIERRE: 'Registrar Cierre',
};

/** Who signs a corte of each type, in the order the blocks appear. */
const SIGNERS: Record<Tipo, { rol: Rol; title: string }[]> = {
    APERTURA: [{ rol: 'APERTURA', title: 'Firma de apertura' }],
    RELEVO: [{ rol: 'SALIENTE', title: 'Sale' }, { rol: 'ENTRANTE', title: 'Entra' }],
    CIERRE: [{ rol: 'CIERRE', title: 'Firma de cierre' }],
};

/**
 * A typed amount as integer cents, or null when it is not a valid count.
 * Blank is not zero here: an empty box must be typed as 0 on purpose.
 */
function parseCount(raw: string): number | null {
    const t = raw.trim();
    if (!t) return null;
    const n = Number(t.replace(/[$,\s]/g, ''));
    if (!Number.isFinite(n) || n < 0) return null;
    return toCents(t);
}

type Comparison =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'error' }
    | { status: 'ready'; data: EsperadoOk };

/**
 * The corte form. The count is blind: nothing from Clover is shown until
 * both boxes are typed and "Ver comparación" is tapped, and at that point
 * the amounts lock so the comparison and the count stay the same numbers.
 */
export default function CajaCorteModal({ tipo, staff, onClose, onSaved }: {
    tipo: Tipo;
    staff: Staff[];
    onClose: () => void;
    onSaved: (corteId: string) => void;
}) {
    const [blancaStr, setBlancaStr] = useState('');
    const [negraStr, setNegraStr] = useState('');
    const [tabsConfirmadas, setTabsConfirmadas] = useState(false);
    const [comparison, setComparison] = useState<Comparison>({ status: 'idle' });
    const [motivos, setMotivos] = useState<Record<Box, string>>({ BLANCA: '', NEGRA: '' });
    const [signers, setSigners] = useState<Partial<Record<Rol, Staff>>>({});
    const [signatures, setSignatures] = useState<Partial<Record<Rol, SignatureValue | null>>>({});
    const [isSubmitting, setIsSubmitting] = useState(false);

    const blancaCents = parseCount(blancaStr);
    const negraCents = parseCount(negraStr);
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

    const signersOk = SIGNERS[tipo].every(s => signers[s.rol] && signatures[s.rol]);

    const canCompare = countsValid && (tipo !== 'CIERRE' || tabsConfirmadas) && !busy;
    const canSave = countsValid
        && (!needsComparison || (comparison.status === 'ready' && !sinApertura))
        && motivosOk
        && signersOk
        && !busy;

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

    const handleSave = async () => {
        if (!canSave || blancaCents === null || negraCents === null) return;
        setIsSubmitting(true);
        try {
            const result = await createCajaCorte({
                tipo,
                lineas: [
                    { caja: 'BLANCA', contadoCents: blancaCents, motivo: motivos.BLANCA.trim() || undefined },
                    { caja: 'NEGRA', contadoCents: negraCents, motivo: motivos.NEGRA.trim() || undefined },
                ],
                firmas: SIGNERS[tipo].map(s => {
                    const who = signers[s.rol]!;
                    const sig = signatures[s.rol]!;
                    return { rol: s.rol, employeeId: who.id, employeeName: who.name, firmaPath: sig.path, firmaBox: sig.box };
                }),
                tabsConfirmadas: tipo === 'CIERRE' ? tabsConfirmadas : undefined,
                notas: undefined,
            });
            if (!result.success || !result.corteId) {
                alert(result.error ?? 'No se pudo guardar el corte.');
                return;
            }
            onSaved(result.corteId);
        } catch (e) {
            alert(e instanceof Error ? e.message : String(e));
        } finally {
            setIsSubmitting(false);
        }
    };

    // ── Pieces ───────────────────────────────────────────────────────────────

    const moneyInput = (caja: Box, value: string, setValue: (v: string) => void, hint: string) => {
        const invalid = value.trim() !== '' && parseCount(value) === null;
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <label style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {CAJA_LABELS[caja]}
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
                            const cents = parseCount(value);
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
                    {invalid ? 'Escribe un monto válido, cero o mayor.' : hint}
                </span>
            </div>
        );
    };

    const compareRow = (label: string, contado: number, esperado: number | null, badge: React.ReactNode, note?: React.ReactNode) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '1rem 0', borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{label}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', alignItems: 'center' }}>
                <div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Contado</div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-primary)' }}>{formatMoney(contado)}</div>
                </div>
                <div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Esperado</div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                        {esperado === null ? '—' : formatMoney(esperado)}
                    </div>
                </div>
                <div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Diferencia</div>
                    <div style={{ marginTop: '0.2rem' }}>{badge}</div>
                </div>
            </div>
            {note}
        </div>
    );

    const motivoField = (caja: Box, required: boolean) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <label style={{ fontSize: '1rem', fontWeight: 600, color: required ? 'var(--danger)' : 'var(--text-secondary)' }}>
                {required ? 'Motivo (obligatorio)' : 'Motivo (opcional)'}
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
            return <p style={{ margin: 0, fontSize: '1.05rem', color: 'var(--text-secondary)' }}>Consultando Clover…</p>;
        }
        if (comparison.status === 'error') {
            return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <p style={{ margin: 0, fontSize: '1.05rem', color: 'var(--danger)' }}>
                        No se pudo consultar Clover. Intenta de nuevo.
                    </p>
                    <button type="button" onClick={runComparison} className="btn-secondary" style={secondaryBtn}>
                        Reintentar
                    </button>
                </div>
            );
        }
        if (comparison.status !== 'ready' || blancaCents === null || negraCents === null) return null;
        const d = comparison.data;

        if (sinApertura) {
            return (
                <p style={{ margin: 0, fontSize: '1.05rem', color: 'var(--danger)' }}>
                    Sin apertura registrada. Registra la apertura de hoy antes de este corte.
                </p>
            );
        }

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                {compareRow(
                    CAJA_LABELS.BLANCA, blancaCents, blancaEsperado,
                    blancaNivel !== null && blancaDiff !== null ? <NivelBadge nivel={blancaNivel} diffCents={blancaDiff} /> : null,
                    blancaNivel === 'DESCUADRE' || blancaNivel === 'MENOR' ? motivoField('BLANCA', blancaNivel === 'DESCUADRE') : undefined,
                )}

                {negraFirm
                    ? compareRow(
                        CAJA_LABELS.NEGRA, negraCents, negraEsperado,
                        negraNivel !== null && negraDiff !== null ? <NivelBadge nivel={negraNivel} diffCents={negraDiff} /> : null,
                        negraNivel === 'DESCUADRE' || negraNivel === 'MENOR' ? motivoField('NEGRA', negraNivel === 'DESCUADRE') : undefined,
                    )
                    : compareRow(
                        CAJA_LABELS.NEGRA, negraCents, null,
                        <SinVerificar />,
                        <p style={{ margin: 0, fontSize: '0.95rem', color: 'var(--text-secondary)' }}>
                            Referencia estimada: {negraEsperado === null ? '—' : formatMoney(negraEsperado)}
                            {' '}(mesas abiertas: {d.negra.abiertasCount}) — no se verifica en relevos
                        </p>,
                    )}

                {negraFirm && totalDiff !== null && totalNivel !== null && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', padding: '1rem 0', borderTop: '1px solid var(--border)' }}>
                        <span style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>Total</span>
                        <span style={{ fontSize: '1.1rem', color: 'var(--text-secondary)' }}>{signedMoney(totalDiff)}</span>
                        <NivelBadge nivel={totalNivel} diffCents={totalDiff} />
                        {posibleTraslado && <PosibleTraslado />}
                    </div>
                )}

                {d.negra.pendientesCount > 0 && (
                    <p style={{ margin: 0, padding: '0.75rem 1rem', borderRadius: '10px', background: '#fef3c7', color: '#92400e', fontSize: '0.95rem' }}>
                        {d.negra.pendientesCount} {d.negra.pendientesCount === 1 ? 'mesa' : 'mesas'} de días anteriores
                        {' '}{d.negra.pendientesCount === 1 ? 'sigue abierta' : 'siguen abiertas'} en Clover ({formatMoney(d.negra.pendientesCents)}).
                        {' '}No entran en el esperado.
                    </p>
                )}

                {d.truncated && (
                    <p style={{ margin: 0, fontSize: '0.95rem', color: 'var(--text-secondary)' }}>
                        Clover devolvió demasiadas órdenes; el esperado puede estar incompleto.
                    </p>
                )}
            </div>
        );
    };

    const signerBlock = (s: { rol: Rol; title: string }) => {
        const chosen = signers[s.rol] ?? null;
        // In a relevo the same person cannot both hand over and receive.
        const takenElsewhere = new Set(
            SIGNERS[tipo].filter(o => o.rol !== s.rol).map(o => signers[o.rol]?.id).filter(Boolean)
        );
        return (
            <div key={s.rol} className="glass-panel" style={{ padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <span style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{s.title}</span>
                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                    {staff.length === 0 && (
                        <span style={{ color: 'var(--text-secondary)', fontSize: '1rem' }}>No hay personal disponible.</span>
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
                                    setSigners(prev => ({ ...prev, [s.rol]: isOn ? undefined : person }));
                                    setSignatures(prev => ({ ...prev, [s.rol]: null }));
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
                            value={signatures[s.rol] ?? null}
                            onChange={v => setSignatures(prev => ({ ...prev, [s.rol]: v }))}
                            disabled={busy}
                        />
                        <span style={{ fontSize: '0.95rem', color: 'var(--text-secondary)' }}>
                            {chosen.name} — la hora se registra al guardar
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
                    {TITLES[tipo]}
                </h3>

                {/* 1 — Conteo */}
                <section style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {sectionTitle('Conteo')}
                    {moneyInput('BLANCA', blancaStr, setBlancaStr, 'Efectivo de cuentas cerradas en Clover')}
                    {moneyInput('NEGRA', negraStr, setNegraStr, 'Efectivo de cuentas que siguen abiertas')}

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
                            <span style={{ fontSize: '1.05rem', color: 'var(--text-primary)' }}>
                                Confirmo que solo quedan abiertas las mesas que pagaron en efectivo
                            </span>
                        </label>
                    )}

                    {needsComparison && (
                        inputsLocked ? (
                            <button type="button" onClick={unlock} disabled={busy} className="btn-secondary" style={secondaryBtn}>
                                Editar cantidades
                            </button>
                        ) : (
                            <button type="button" onClick={runComparison} disabled={!canCompare} style={primaryBtn(!canCompare)}>
                                Ver comparación
                            </button>
                        )
                    )}
                </section>

                {/* 2 — Comparación */}
                {needsComparison && comparison.status !== 'idle' && (
                    <section style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        {sectionTitle('Comparación')}
                        {renderComparison()}
                    </section>
                )}

                {/* 3 — Firmas */}
                <section style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {sectionTitle('Firmas')}
                    {SIGNERS[tipo].map(signerBlock)}
                </section>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <button type="button" onClick={onClose} disabled={busy} className="btn-secondary" style={secondaryBtn}>
                        Cancelar
                    </button>
                    <button type="button" onClick={handleSave} disabled={!canSave} style={primaryBtn(!canSave)}>
                        {isSubmitting ? 'Guardando…' : 'Guardar corte'}
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
