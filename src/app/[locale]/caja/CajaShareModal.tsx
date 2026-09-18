'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toPng } from 'html-to-image';
import { getCajaDia, marcarCajaCompartido } from '@/app/actions/caja';
import { nivelFor } from '@/lib/cajaRules';
import { formatMoney } from '@/lib/money';
import { businessDateToUtcDate, formatBusinessDateEs } from '@/lib/businessDay';
import SenderPicker, { senderDisplayNames } from '@/components/ui/SenderPicker';
import { nyTime, signedMoney } from './cajaUi';

type Dia = Awaited<ReturnType<typeof getCajaDia>>;
type Corte = Dia['cortes'][number];
type Mov = Dia['movimientos'][number];
type Staff = { id: string; name: string };

/**
 * The captured content is ALWAYS Spanish: it goes to the staff WhatsApp
 * group, whatever language the tablet is set to. Only the modal chrome
 * (sender picker, buttons) is translated.
 */
const ES = {
    box: { BLANCA: 'Caja Blanca', NEGRA: 'Caja Negra' } as const,
    rol: { APERTURA: 'Apertura', SALIENTE: 'Sale', ENTRANTE: 'Entra', CIERRE: 'Cierre' } as const,
    mov: { RETIRO: 'Retiro', COMPRA: 'Compra', INGRESO: 'Ingreso de cambio' } as const,
    nivel: { OK: 'Cuadra', MENOR: 'Diferencia menor', DESCUADRE: 'DESCUADRE' } as const,
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
} as const;

const movSigned = (m: Mov) => (m.tipo === 'INGRESO' ? m.amountCents : -m.amountCents);

/**
 * Share the day's closing as one image: both boxes with their verdicts, the
 * movements, the total, and every signature — signatures only exist as
 * pictures, which is why this is an image and the shift lists are text.
 *
 * Plain inline modal, deliberately: no glass-panel, no backdrop-filter, no
 * transform anywhere inside, because html-to-image renders none of those.
 */
export default function CajaShareModal({ corte, movimientos, businessDate, staff, onClose }: {
    corte: Corte;
    /** The day's live movements, oldest first. */
    movimientos: Mov[];
    businessDate: string;
    staff: Staff[];
    onClose: () => void;
}) {
    const t = useTranslations('Caja');
    const captureRef = useRef<HTMLDivElement>(null);
    const [sender, setSender] = useState<Staff | null>(null);
    const [sharing, setSharing] = useState(false);

    const names = senderDisplayNames(staff);
    const senderLabel = sender ? (names.get(sender.id) ?? sender.name) : '';

    const lineas = [...corte.lineas].sort((a, b) => a.caja.localeCompare(b.caja));
    const totalNivel = corte.totalDiffCents === null ? null : nivelFor(corte.totalDiffCents, corte.toleranciaCents);
    const fechaLarga = formatBusinessDateEs(businessDateToUtcDate(businessDate));

    // Runs from the button's own tap. iOS refuses a share sheet that is not
    // opened by a direct user gesture, so nothing here is chained to a save.
    const handleShare = async () => {
        if (!captureRef.current || !sender || sharing) return;
        setSharing(true);
        try {
            const dataUrl = await toPng(captureRef.current, {
                pixelRatio: 2,
                backgroundColor: PAPER,
                cacheBust: true,
                filter: node => !(node instanceof HTMLElement && node.dataset.noCapture === 'true'),
            });
            const blob = await (await fetch(dataUrl)).blob();
            const file = new File([blob], `cierre-caja-${businessDate}.png`, { type: 'image/png' });

            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({ files: [file], title: `Cierre de Caja — ${fechaLarga}` });
            } else {
                // Desktop fallback: download the PNG.
                const a = document.createElement('a');
                a.href = dataUrl;
                a.download = file.name;
                a.click();
            }
            // Best effort, never blocks: the share already happened.
            void marcarCajaCompartido(corte.id);
        } catch (err) {
            // AbortError = the share sheet was dismissed; that is not a failure.
            if ((err as Error).name !== 'AbortError') {
                console.error('Error al compartir el cierre:', err);
                alert(t('share_failed'));
            }
        } finally {
            setSharing(false);
        }
    };

    const verdict = (nivel: 'OK' | 'MENOR' | 'DESCUADRE', diff: number) => {
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

    return (
        <div
            onClick={() => { if (!sharing) onClose(); }}
            style={{
                position: 'fixed', inset: 0, zIndex: 1000,
                background: 'rgba(0,0,0,0.5)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '1rem'
            }}
        >
            <div
                onClick={e => e.stopPropagation()}
                style={{
                    background: 'var(--bg-primary)', border: '1px solid var(--border)',
                    borderRadius: '12px', width: '100%', maxWidth: '640px', maxHeight: '90vh',
                    display: 'flex', flexDirection: 'column', overflow: 'hidden'
                }}
            >
                <h2 style={{ margin: 0, padding: '1.25rem 1.5rem 0.75rem', fontSize: '1.4rem', color: 'var(--text-primary)' }}>
                    {t('share_title')}
                </h2>

                <div style={{ overflowY: 'auto', padding: '0 1.5rem 1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>

                    {/* Sender — outside the capture ref; the picker marks itself data-no-capture too. */}
                    <SenderPicker staff={staff} value={sender} onChange={setSender} label={t('share_who')} />
                    {staff.length === 0 && (
                        <span data-no-capture="true" style={{ color: 'var(--text-secondary)', fontSize: '1rem' }}>{t('no_staff')}</span>
                    )}

                    {/* Capture surface. Hex colours only — see the constants above. */}
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
                            <div style={{ fontSize: '1.2rem', fontWeight: 700, color: INK }}>Cierre de Caja — {fechaLarga}</div>
                            <div style={{ fontSize: '0.85rem', color: MUTED, marginTop: '0.15rem' }}>
                                Corte #{corte.seq} · {nyTime(corte.at)}
                            </div>
                        </div>

                        {lineas.map(l => (
                            <div key={l.id} style={{ borderTop: `1px solid ${LINE}`, paddingTop: '0.7rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                                <div style={{ fontSize: '1.05rem', fontWeight: 700, color: INK }}>{ES.box[l.caja]}</div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.4fr', gap: '0.5rem', alignItems: 'center' }}>
                                    <div>
                                        <div style={{ fontSize: '0.75rem', color: MUTED }}>Contado</div>
                                        <div style={{ fontSize: '1.05rem', fontWeight: 700, color: INK }}>{formatMoney(l.contadoCents)}</div>
                                    </div>
                                    <div>
                                        <div style={{ fontSize: '0.75rem', color: MUTED }}>Esperado</div>
                                        <div style={{ fontSize: '1.05rem', fontWeight: 700, color: INK }}>
                                            {l.esperadoCents === null ? '—' : formatMoney(l.esperadoCents)}
                                        </div>
                                    </div>
                                    <div>
                                        <div style={{ fontSize: '0.75rem', color: MUTED }}>Diferencia</div>
                                        <div style={{ marginTop: '0.15rem' }}>
                                            {l.nivel !== null && l.diffCents !== null ? verdict(l.nivel, l.diffCents) : <span style={{ color: MUTED }}>—</span>}
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

                        {corte.totalDiffCents !== null && totalNivel !== null && (
                            <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: '0.7rem', display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                                <span style={{ fontSize: '1rem', fontWeight: 700, color: INK }}>Total</span>
                                <span style={{ fontSize: '1rem', color: INK }}>{signedMoney(corte.totalDiffCents)}</span>
                                {verdict(totalNivel, corte.totalDiffCents)}
                                {corte.posibleTraslado && (
                                    <span style={{ display: 'inline-block', padding: '0.2rem 0.6rem', borderRadius: '999px', background: TONE.MENOR.bg, color: TONE.MENOR.fg, fontWeight: 600, fontSize: '0.9rem' }}>
                                        Posible traslado entre cajas
                                    </span>
                                )}
                            </div>
                        )}

                        {corte.firmas.length > 0 && (
                            <div style={{ borderTop: `1px solid ${LINE}`, paddingTop: '0.7rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                                {corte.firmas.map(f => (
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
                </div>

                <div data-no-capture="true" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', flexWrap: 'wrap', padding: '0.75rem 1.5rem 1.25rem', borderTop: '1px solid var(--border)' }}>
                    {!sender && (
                        <span style={{ alignSelf: 'center', marginRight: 'auto', fontSize: '0.95rem', color: 'var(--text-secondary)' }}>{t('share_pick_sender')}</span>
                    )}
                    <button type="button" onClick={onClose} disabled={sharing} className="btn-secondary" style={secondaryBtn}>
                        {t('close')}
                    </button>
                    <button type="button" onClick={handleShare} disabled={!sender || sharing} style={primaryBtn(!sender || sharing)}>
                        {sharing ? t('share_sharing') : t('share_button')}
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
