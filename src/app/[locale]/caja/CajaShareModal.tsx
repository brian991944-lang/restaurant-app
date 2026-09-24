'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toPng } from 'html-to-image';
import { getCajaDia, marcarCajaCompartido } from '@/app/actions/caja';
import { nivelFor } from '@/lib/cajaRules';
import { businessDateToUtcDate, formatBusinessDateEs } from '@/lib/businessDay';
import SenderPicker, { senderDisplayNames } from '@/components/ui/SenderPicker';
import CajaShareCapture, { type ShareCorteData, type ShareMovData } from './CajaShareCapture';

type Dia = Awaited<ReturnType<typeof getCajaDia>>;
type Corte = Dia['cortes'][number];
type Mov = Dia['movimientos'][number];
type Staff = { id: string; name: string };

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

    const fechaLarga = formatBusinessDateEs(businessDateToUtcDate(businessDate));

    const shareData: ShareCorteData = {
        seq: corte.seq,
        at: corte.at,
        lineas: corte.lineas.map(l => ({
            id: l.id, caja: l.caja, contadoCents: l.contadoCents, esperadoCents: l.esperadoCents,
            nivel: l.nivel, diffCents: l.diffCents, motivo: l.motivo, movimientosCents: l.movimientosCents,
        })),
        totalDiffCents: corte.totalDiffCents,
        totalNivel: corte.totalDiffCents === null ? null : nivelFor(corte.totalDiffCents, corte.toleranciaCents),
        posibleTraslado: corte.posibleTraslado,
        firmas: corte.firmas.map(f => ({
            id: f.id, rol: f.rol, employeeName: f.employeeName, firmaPath: f.firmaPath, firmaBox: f.firmaBox, signedAt: f.signedAt,
        })),
    };
    const shareMovs: ShareMovData[] = movimientos.map(m => ({
        id: m.id, tipo: m.tipo, caja: m.caja, amountCents: m.amountCents, descripcion: m.descripcion,
    }));

    // Runs from the button's own tap. iOS refuses a share sheet that is not
    // opened by a direct user gesture, so nothing here is chained to a save.
    const handleShare = async () => {
        if (!captureRef.current || !sender || sharing) return;
        setSharing(true);
        try {
            const dataUrl = await toPng(captureRef.current, {
                pixelRatio: 2,
                backgroundColor: '#ffffff',
                cacheBust: true,
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

                    {/* Capture surface — shared with CajaCorteModal's save-and-share preview. */}
                    <CajaShareCapture
                        captureRef={captureRef}
                        businessDate={businessDate}
                        data={shareData}
                        movimientos={shareMovs}
                        senderLabel={senderLabel}
                    />
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
