'use client';

import { formatMoney } from '@/lib/money';
import { businessDateToUtcDate, formatBusinessDateEs } from '@/lib/businessDay';
import { nyTime, signedMoney } from './cajaUi';

type CajaBox = 'BLANCA' | 'NEGRA';
type CajaMovimientoTipo = 'RETIRO' | 'COMPRA' | 'INGRESO';

/**
 * Everything the capture needs to draw one movimiento, independent of
 * whether it came from a saved CajaMovimiento (a retry share) or from the
 * movement form's own state before it has been saved at all (the
 * save-and-share button). `signedAt` is the DB's defaulted timestamp once
 * saved, or "now" as the best guess of what it will be when the pre-save
 * preview is built.
 *
 * `expectedAfterCents` is only ever known at build time, from the
 * getCajaEsperado snapshot the movement form already fetched for itself —
 * a retry, after the fact, has nothing stored to recompute it from
 * faithfully (CajaMovimiento keeps no esperado snapshot, unlike a corte
 * line), so it comes through as null there.
 */
export type ShareMovimientoData = {
    tipo: CajaMovimientoTipo;
    caja: CajaBox;
    amountCents: number;
    descripcion: string;
    expectedAfterCents: number | null;
    firma: { employeeName: string; firmaPath: string; firmaBox: string; signedAt: Date };
};

/**
 * The captured content is ALWAYS Spanish: it goes to the staff WhatsApp
 * group, whatever language the tablet is set to.
 */
const ES = {
    box: { BLANCA: 'Caja Blanca', NEGRA: 'Caja Negra' } as const,
    mov: { RETIRO: 'Retiro', COMPRA: 'Compra', INGRESO: 'Ingreso de cambio' } as const,
};

/**
 * Hex literals only. The capture is rasterised by html-to-image, which does
 * not resolve the app's CSS variables reliably.
 */
const INK = '#111827';
const MUTED = '#6b7280';
const LINE = '#e5e7eb';
const PAPER = '#ffffff';

const movSigned = (m: Pick<ShareMovimientoData, 'tipo' | 'amountCents'>) =>
    (m.tipo === 'INGRESO' ? m.amountCents : -m.amountCents);

/**
 * A movimiento as one image: type, box, signed amount, what it was for, the
 * box's expected amount after it (when known), and the signature — the same
 * construction rules as CajaShareCapture: no glass-panel, no
 * backdrop-filter, no transform anywhere inside, because html-to-image
 * renders none of those.
 */
export default function CajaMovimientoCapture({ captureRef, businessDate, data, senderLabel }: {
    captureRef: React.RefObject<HTMLDivElement | null>;
    businessDate: string;
    data: ShareMovimientoData;
    senderLabel: string;
}) {
    const fechaLarga = formatBusinessDateEs(businessDateToUtcDate(businessDate));

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
                <div style={{ fontSize: '1.2rem', fontWeight: 700, color: INK }}>Movimiento de Caja — {fechaLarga}</div>
                <div style={{ fontSize: '0.85rem', color: MUTED, marginTop: '0.15rem' }}>
                    {nyTime(data.firma.signedAt)}
                </div>
            </div>

            <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: '0.7rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <div style={{ fontSize: '1.05rem', fontWeight: 700, color: INK }}>
                    {ES.mov[data.tipo]} · {ES.box[data.caja]}
                </div>
                <div style={{ fontSize: '1.3rem', fontWeight: 700, color: INK }}>
                    {signedMoney(movSigned(data))}
                </div>
                <div style={{ fontSize: '1rem', color: INK }}>{data.descripcion}</div>
                {data.expectedAfterCents !== null && (
                    <div style={{ fontSize: '0.85rem', color: MUTED }}>
                        Debe haber ahora en {ES.box[data.caja]}: {formatMoney(data.expectedAfterCents)}
                    </div>
                )}
            </div>

            <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: '0.7rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    <div style={{ width: '160px', height: '54px', background: PAPER, borderRadius: '6px', border: `1px solid ${LINE}`, overflow: 'hidden' }}>
                        <svg viewBox={`0 0 ${data.firma.firmaBox}`} width="160" height="54" preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}>
                            <path d={data.firma.firmaPath} fill="none" stroke={INK} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </div>
                    <span style={{ fontSize: '0.8rem', color: MUTED }}>
                        {data.firma.employeeName} · {nyTime(data.firma.signedAt)}
                    </span>
                </div>
            </div>

            <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: '0.6rem', fontSize: '0.85rem', color: MUTED }}>
                Enviado por {senderLabel || '—'} · {nyTime(new Date())}
            </div>
        </div>
    );
}
