'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toPng } from 'html-to-image';
import { getCajaDia } from '@/app/actions/caja';
import { businessDateToUtcDate, formatBusinessDateEs } from '@/lib/businessDay';
import SenderPicker, { senderDisplayNames } from '@/components/ui/SenderPicker';
import CajaMovimientoCapture, { type ShareMovimientoData } from './CajaMovimientoCapture';

type Dia = Awaited<ReturnType<typeof getCajaDia>>;
type Mov = Dia['movimientos'][number];
type Staff = { id: string; name: string };

/**
 * Re-share a saved movimiento, reached from its timeline card's Share button
 * when the original save-and-share attempt was dismissed or failed. No
 * esperado snapshot survives on a CajaMovimiento row — unlike a CajaCorte
 * line, it keeps none — so a retry's capture never shows the box's expected
 * amount after; only the original, pre-save capture had that available.
 *
 * Plain inline modal, deliberately: no glass-panel, no backdrop-filter, no
 * transform anywhere inside, because html-to-image renders none of those.
 */
export default function CajaMovimientoShareModal({ mov, businessDate, staff, onClose }: {
    mov: Mov;
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

    const shareData: ShareMovimientoData = {
        tipo: mov.tipo, caja: mov.caja, amountCents: mov.amountCents, descripcion: mov.descripcion,
        expectedAfterCents: null,
        firma: { employeeName: mov.employeeName, firmaPath: mov.firmaPath, firmaBox: mov.firmaBox, signedAt: mov.at },
    };

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
            const file = new File([blob], `movimiento-caja-${businessDate}.png`, { type: 'image/png' });

            if (navigator.canShare && navigator.canShare({ files: [file] })) {
                await navigator.share({ files: [file], title: `Movimiento de Caja — ${fechaLarga}` });
            } else {
                // Desktop fallback: download the PNG.
                const a = document.createElement('a');
                a.href = dataUrl;
                a.download = file.name;
                a.click();
            }
        } catch (err) {
            // AbortError = the share sheet was dismissed; that is not a failure.
            if ((err as Error).name !== 'AbortError') {
                console.error('Error al compartir el movimiento:', err);
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
                    {t('share_title_MOVIMIENTO')}
                </h2>

                <div style={{ overflowY: 'auto', padding: '0 1.5rem 1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <SenderPicker staff={staff} value={sender} onChange={setSender} label={t('share_who')} />
                    {staff.length === 0 && (
                        <span style={{ color: 'var(--text-secondary)', fontSize: '1rem' }}>{t('no_staff')}</span>
                    )}

                    <CajaMovimientoCapture
                        captureRef={captureRef}
                        businessDate={businessDate}
                        data={shareData}
                        senderLabel={senderLabel}
                    />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', flexWrap: 'wrap', padding: '0.75rem 1.5rem 1.25rem', borderTop: '1px solid var(--border)' }}>
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
