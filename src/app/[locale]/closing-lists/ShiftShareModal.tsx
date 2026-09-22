'use client';

import { useState } from 'react';
import { marcarShiftCompartido, type ShiftListType } from '@/app/actions/shiftLists';
import { businessDateToUtcDate, formatBusinessDateEs } from '@/lib/businessDay';
import SenderPicker, { senderDisplayNames } from '@/components/ui/SenderPicker';

type Staff = { id: string; name: string };

/** A photo attached to the share — in-memory only, gone on reload. */
export type SharePhoto = { id: string; file: File };

/**
 * What the modal shares. Taken BEFORE the completion round-trip, so the
 * refetch that follows cannot change what the person pressed the button on.
 */
export type ShiftShareSnapshot = {
    listType: ShiftListType;
    businessDate: string;
    sections: {
        name: string;
        tasks: { text: string; checked: boolean; /** LIMPIEZA only: this task has an Antes/Después composite. */ hasPhotos?: boolean }[];
        staffNames: string[];
    }[];
};

const TITULO: Record<ShiftListType, string> = {
    APERTURA: '📋 *Apertura',
    CIERRE: '📋 *Cierre',
    LIMPIEZA: '🧽 *Limpieza Profunda',
};

/**
 * The WhatsApp message. Always Spanish — it goes to the staff group whatever
 * language the tablet is set to — and text rather than an image, because a
 * checklist reads fine as ✅/⬜ lines and stays searchable and copyable.
 */
export function buildListaTexto(snapshot: ShiftShareSnapshot, sender: string, extraText?: string): string {
    const fecha = formatBusinessDateEs(businessDateToUtcDate(snapshot.businessDate));

    const lines: string[] = [`${TITULO[snapshot.listType]} — ${fecha}*`, ''];
    let total = 0;
    let hechas = 0;
    for (const section of snapshot.sections) {
        lines.push(`*${section.name}*`);
        for (const task of section.tasks) {
            total++;
            if (task.checked) hechas++;
            lines.push(`${task.checked ? '✅' : '⬜'} ${task.text}${task.hasPhotos ? ' 📷' : ''}`);
        }
        lines.push(`👤 ${section.staffNames.length > 0 ? section.staffNames.join(', ') : '—'}`);
        lines.push('');
    }
    if (extraText && extraText.trim()) {
        lines.push(extraText.trim());
        lines.push('');
    }
    lines.push(`${hechas} de ${total} completadas`);
    lines.push(`Enviado por ${sender}`);
    return lines.join('\n');
}

/**
 * Opens after "Completar y compartir" succeeds, and again from "Compartir"
 * on a completed list. The share itself runs from this modal's own button:
 * iOS refuses a share sheet that is not opened by a direct user gesture, so
 * it is never chained onto the completion await.
 */
export default function ShiftShareModal({ snapshot, staff, onClose, photos, extraText }: {
    snapshot: ShiftShareSnapshot;
    staff: Staff[];
    onClose: () => void;
    /** In-memory photos to attach (LIMPIEZA). Never stored; gone on reload. */
    photos?: SharePhoto[];
    /** Free text appended before the footer. */
    extraText?: string;
}) {
    const [sender, setSender] = useState<Staff | null>(null);
    const [sharing, setSharing] = useState(false);

    const names = senderDisplayNames(staff);
    const senderLabel = sender ? (names.get(sender.id) ?? sender.name) : '—';
    const texto = buildListaTexto(snapshot, senderLabel, extraText);
    const files = (photos ?? []).map(p => p.file);

    const copiarFallback = async (text: string): Promise<boolean> => {
        try {
            await navigator.clipboard.writeText(text);
            alert('Lista copiada al portapapeles. Pégala en WhatsApp.');
            return true;
        } catch (err) {
            // Rejects on an insecure origin or without a user gesture.
            console.error('Error al copiar la lista:', err);
            alert('No se pudo copiar la lista. Intenta de nuevo.');
            return false;
        }
    };

    const handleShare = async () => {
        if (!sender || sharing) return;
        setSharing(true);
        try {
            let shared = false;
            if (navigator.share) {
                try {
                    // Photos ride along only where the device can take them;
                    // otherwise the text goes alone and the person is told.
                    const withFiles = files.length > 0 && !!navigator.canShare && navigator.canShare({ files });
                    await navigator.share(withFiles ? { files, text: texto } : { text: texto });
                    shared = true;
                    if (files.length > 0 && !withFiles) {
                        alert('Las fotos no se pudieron adjuntar en este dispositivo. Se compartió solo el texto.');
                    }
                } catch (err) {
                    // AbortError = the sheet was dismissed. Not a failure, and
                    // NOT a reason to copy to the clipboard behind their back.
                    if ((err as Error).name === 'AbortError') return;
                    shared = await copiarFallback(texto);
                }
            } else {
                shared = await copiarFallback(texto);
                if (shared && files.length > 0) {
                    alert('Las fotos no se pudieron adjuntar en este dispositivo. Se copió solo el texto.');
                }
            }
            // Best effort, never blocks: the share already happened.
            if (shared) void marcarShiftCompartido(snapshot.listType);
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
                    borderRadius: '12px', width: '100%', maxWidth: '560px', maxHeight: '90vh',
                    display: 'flex', flexDirection: 'column', overflow: 'hidden'
                }}
            >
                <h2 style={{ margin: 0, padding: '1.25rem 1.5rem 0.5rem', fontSize: '1.4rem', color: 'var(--text-primary)' }}>
                    Lista completada
                </h2>
                <p style={{ margin: 0, padding: '0 1.5rem 1rem', color: 'var(--text-secondary)', fontSize: '1rem' }}>
                    Compártela en el grupo de WhatsApp.
                </p>

                <div style={{ overflowY: 'auto', padding: '0 1.5rem 1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    <SenderPicker staff={staff} value={sender} onChange={setSender} label="¿Quién envía?" />
                    {staff.length === 0 && (
                        <span style={{ color: 'var(--text-secondary)', fontSize: '1rem' }}>No hay personal disponible.</span>
                    )}

                    {/* Preview of exactly what will be sent. */}
                    <pre style={{
                        margin: 0, padding: '1.25rem', borderRadius: '8px',
                        background: '#ffffff', color: '#111827', border: '1px solid #e5e7eb',
                        fontFamily: 'inherit', fontSize: '1rem', lineHeight: 1.5,
                        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                    }}>
                        {texto}
                    </pre>
                    {files.length > 0 && (
                        <span style={{ fontSize: '0.95rem', color: 'var(--text-secondary)' }}>
                            📷 {files.length === 1 ? '1 foto adjunta' : `${files.length} fotos adjuntas`} — solo se envían con este mensaje, no se guardan.
                        </span>
                    )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', flexWrap: 'wrap', padding: '0.75rem 1.5rem 1.25rem', borderTop: '1px solid var(--border)' }}>
                    {!sender && (
                        <span style={{ alignSelf: 'center', marginRight: 'auto', fontSize: '0.95rem', color: 'var(--text-secondary)' }}>Elige quién envía.</span>
                    )}
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={sharing}
                        className="btn-secondary"
                        style={{
                            minHeight: '56px', padding: '0.9rem 1.4rem', borderRadius: '8px',
                            fontSize: '1.1rem', fontWeight: 600, cursor: 'pointer',
                            background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)',
                            color: 'var(--text-primary)',
                        }}
                    >
                        Cerrar
                    </button>
                    <button
                        type="button"
                        onClick={handleShare}
                        disabled={!sender || sharing}
                        style={{
                            minHeight: '56px', padding: '0.9rem 1.6rem', borderRadius: '8px',
                            fontSize: '1.1rem', fontWeight: 700, cursor: !sender || sharing ? 'default' : 'pointer',
                            background: 'var(--success)', border: '1px solid var(--success)',
                            color: 'white', opacity: !sender || sharing ? 0.5 : 1,
                        }}
                    >
                        {sharing ? 'Compartiendo…' : 'Compartir'}
                    </button>
                </div>
            </div>
        </div>
    );
}
