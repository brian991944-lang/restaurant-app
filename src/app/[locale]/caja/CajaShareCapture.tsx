'use client';

import { formatMoney } from '@/lib/money';
import { businessDateToUtcDate, formatBusinessDateEs } from '@/lib/businessDay';
import type { CajaNivel } from '@/lib/cajaRules';
import { nyTime, signedMoney } from './cajaUi';

type CajaBox = 'BLANCA' | 'NEGRA';
type CajaCorteTipo = 'APERTURA' | 'RELEVO' | 'CIERRE';
type CajaFirmaRol = 'APERTURA' | 'SALIENTE' | 'ENTRANTE' | 'CIERRE';
type CajaMovimientoTipo = 'RETIRO' | 'COMPRA' | 'INGRESO';

/**
 * Everything the capture needs to draw one corte, independent of whether it
 * came from a saved CajaCorte (CajaShareModal, re-sharing) or from the corte
 * form's own state before it has been saved at all (CajaCorteModal, the
 * save-and-share button). `at` and each firma's `signedAt` are the DB's
 * defaulted timestamps once saved, or "now" as the best guess of what they
 * will be when the pre-save preview is built.
 */
export type ShareCorteData = {
    tipo: CajaCorteTipo;
    seq: number;
    at: Date;
    lineas: {
        id: string;
        caja: CajaBox;
        contadoCents: number;
        esperadoCents: number | null;
        /** NEGRA at RELEVO: unverified, `referenciaCents` is the estimate. */
        esEstimado: boolean;
        referenciaCents: number | null;
        nivel: CajaNivel | null;
        diffCents: number | null;
        motivo: string | null;
        movimientosCents: number | null;
    }[];
    totalDiffCents: number | null;
    totalNivel: CajaNivel | null;
    posibleTraslado: boolean;
    firmas: { id: string; rol: CajaFirmaRol; employeeName: string; firmaPath: string; firmaBox: string; signedAt: Date }[];
};

export type ShareMovData = {
    id: string;
    tipo: CajaMovimientoTipo;
    caja: CajaBox;
    amountCents: number;
    descripcion: string;
};

/**
 * The captured content is ALWAYS Spanish: it goes to the staff WhatsApp
 * group, whatever language the tablet is set to.
 */
const ES = {
    titulo: { APERTURA: 'Apertura de Caja', RELEVO: 'Relevo de Caja', CIERRE: 'Cierre de Caja' } as const,
    box: { BLANCA: 'Caja Blanca', NEGRA: 'Caja Negra' } as const,
    rol: { APERTURA: 'Apertura', SALIENTE: 'Sale', ENTRANTE: 'Entra', CIERRE: 'Cierre' } as const,
    mov: { RETIRO: 'Retiro', COMPRA: 'Compra', INGRESO: 'Ingreso de cambio' } as const,
    nivel: { OK: 'Cuadra', MENOR: 'Diferencia menor', DESCUADRE: 'DESCUADRE' } as const,
    fondoInicial: 'Fondo inicial',
    sinVerificar: 'Sin verificar',
    refEstimada: 'Ref. estimada',
};

/**
 * Hex literals only. The capture is rasterised by html-to-image, which does
 * not resolve the app's CSS variables reliably, and the image must read the
 * same on a phone in dark mode as on the tablet that made it.
 */
const INK = '#111827';
const MUTED = '#6b7280';
const LINE = '#e5e7eb';
const PAPER = '#ffffff';
const TONE = {
    OK: { bg: '#dcfce7', fg: '#166534' },
    MENOR: { bg: '#fef3c7', fg: '#92400e' },
    DESCUADRE: { bg: '#fee2e2', fg: '#991b1b' },
    GREY: { bg: '#e5e7eb', fg: '#374151' },
} as const;

const movSigned = (m: ShareMovData) => (m.tipo === 'INGRESO' ? m.amountCents : -m.amountCents);

/**
 * The closing as one image: both boxes with their verdicts, the movements,
 * the total, and every signature. Plain inline markup, deliberately: no
 * glass-panel, no backdrop-filter, no transform anywhere inside, because
 * html-to-image renders none of those.
 */
export default function CajaShareCapture({ captureRef, businessDate, data, movimientos, senderLabel }: {
    captureRef: React.RefObject<HTMLDivElement | null>;
    businessDate: string;
    data: ShareCorteData;
    movimientos: ShareMovData[];
    senderLabel: string;
}) {
    const lineas = [...data.lineas].sort((a, b) => a.caja.localeCompare(b.caja));
    const fechaLarga = formatBusinessDateEs(businessDateToUtcDate(businessDate));
    const esApertura = data.tipo === 'APERTURA';

    const verdict = (nivel: CajaNivel, diff: number) => {
        const tone = TONE[nivel];
        return (
            <span style={{
                display: 'inline-block', padding: '0.2rem 0.6rem', borderRadius: '999px',
                background: tone.bg, color: tone.fg, fontWeight: nivel === 'DESCUADRE' ? 700 : 600, fontSize: '0.9rem',
            }}>
                {ES.nivel[nivel]} {nivel === 'OK' ? '' : signedMoney(diff)}
            </span>
        );
    };

    const greyChip = (text: string) => (
        <span style={{
            display: 'inline-block', padding: '0.2rem 0.6rem', borderRadius: '999px',
            background: TONE.GREY.bg, color: TONE.GREY.fg, fontWeight: 600, fontSize: '0.9rem',
        }}>
            {text}
        </span>
    );

    return (
        <div
            ref={captureRef}
            style={{
                background: PAPER, color: INK,
                padding: '1.25rem', borderRadius: '8px',
                border: `1px solid ${LINE}`,
                display: 'flex', flexDirection: 'column', gap: '0.9rem',
                fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
            }}
        >
            <div>
                <div style={{ fontSize: '1.2rem', fontWeight: 700, color: INK }}>{ES.titulo[data.tipo]} — {fechaLarga}</div>
                <div style={{ fontSize: '0.85rem', color: MUTED, marginTop: '0.15rem' }}>
                    Corte #{data.seq} · {nyTime(data.at)}
                </div>
            </div>

            {lineas.map(l => (
                <div key={l.id} style={{ borderTop: `1px solid ${LINE}`, paddingTop: '0.7rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                    <div style={{ fontSize: '1.05rem', fontWeight: 700, color: INK }}>{ES.box[l.caja]}</div>
                    <div style={{ display: 'grid', gridTemplateColumns: esApertura ? '1fr 1.4fr' : '1fr 1fr 1.4fr', gap: '0.5rem', alignItems: 'center' }}>
                        <div>
                            <div style={{ fontSize: '0.75rem', color: MUTED }}>Contado</div>
                            <div style={{ fontSize: '1.05rem', fontWeight: 700, color: INK }}>{formatMoney(l.contadoCents)}</div>
                        </div>
                        {!esApertura && (
                            <div>
                                <div style={{ fontSize: '0.75rem', color: MUTED }}>Esperado</div>
                                <div style={{ fontSize: '1.05rem', fontWeight: 700, color: INK }}>
                                    {l.esEstimado
                                        ? `${ES.refEstimada} ${l.referenciaCents === null ? '—' : formatMoney(l.referenciaCents)}`
                                        : l.esperadoCents === null ? '—' : formatMoney(l.esperadoCents)}
                                </div>
                            </div>
                        )}
                        <div>
                            {!esApertura && <div style={{ fontSize: '0.75rem', color: MUTED }}>Diferencia</div>}
                            <div style={{ marginTop: '0.15rem' }}>
                                {esApertura ? greyChip(ES.fondoInicial)
                                    : l.esEstimado ? greyChip(ES.sinVerificar)
                                        : l.nivel !== null && l.diffCents !== null ? verdict(l.nivel, l.diffCents)
                                            : <span style={{ color: MUTED }}>—</span>}
                            </div>
                        </div>
                    </div>
                    {l.movimientosCents !== null && l.movimientosCents !== 0 && (
                        <div style={{ fontSize: '0.8rem', color: MUTED }}>incluye movimientos: {signedMoney(l.movimientosCents)}</div>
                    )}
                    {l.motivo && (
                        <div style={{ fontSize: '0.9rem', fontStyle: 'italic', color: MUTED }}>{l.motivo}</div>
                    )}
                </div>
            ))}

            {movimientos.length > 0 && (
                <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: '0.7rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    <div style={{ fontSize: '0.95rem', fontWeight: 700, color: INK }}>Movimientos</div>
                    {movimientos.map(m => (
                        <div key={m.id} style={{ fontSize: '0.9rem', color: INK }}>
                            {ES.mov[m.tipo]} · {ES.box[m.caja]} · {signedMoney(movSigned(m))} · {m.descripcion}
                        </div>
                    ))}
                </div>
            )}

            {data.totalDiffCents !== null && data.totalNivel !== null && (
                <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: '0.7rem', display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '1rem', fontWeight: 700, color: INK }}>Total</span>
                    <span style={{ fontSize: '1rem', color: INK }}>{signedMoney(data.totalDiffCents)}</span>
                    {verdict(data.totalNivel, data.totalDiffCents)}
                    {data.posibleTraslado && (
                        <span style={{ display: 'inline-block', padding: '0.2rem 0.6rem', borderRadius: '999px', background: TONE.MENOR.bg, color: TONE.MENOR.fg, fontWeight: 600, fontSize: '0.9rem' }}>
                            Posible traslado entre cajas
                        </span>
                    )}
                </div>
            )}

            {data.firmas.length > 0 && (
                <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: '0.7rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                    {data.firmas.map(f => (
                        <div key={f.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                            <div style={{ width: '160px', height: '54px', background: PAPER, borderRadius: '6px', border: `1px solid ${LINE}`, overflow: 'hidden' }}>
                                <svg viewBox={`0 0 ${f.firmaBox}`} width="160" height="54" preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}>
                                    <path d={f.firmaPath} fill="none" stroke={INK} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                            </div>
                            <span style={{ fontSize: '0.8rem', color: MUTED }}>
                                {ES.rol[f.rol]} · {f.employeeName} · {nyTime(f.signedAt)}
                            </span>
                        </div>
                    ))}
                </div>
            )}

            <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: '0.6rem', fontSize: '0.85rem', color: MUTED }}>
                Enviado por {senderLabel || '—'} · {nyTime(new Date())}
            </div>
        </div>
    );
}
