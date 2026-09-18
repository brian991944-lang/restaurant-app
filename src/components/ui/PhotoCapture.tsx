'use client';

import { useRef, useState } from 'react';

/**
 * A photo held in memory for the length of the session. Nothing here is
 * stored anywhere — no localStorage, no IndexedDB, no upload, no database.
 * It exists to be attached to a share and is gone on reload.
 */
export type CapturedPhoto = { id: string; dataUrl: string; file: File };

/** Long edge after downscaling. */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.8;

const slug = (s: string) =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'foto';

const newId = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function loadImage(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen.')); };
        img.src = url;
    });
}

/**
 * Draw the image onto a canvas at most MAX_EDGE on its long side and re-encode
 * it as JPEG. A tablet holding eight full-resolution phone photos in memory
 * is killed by Safari; this is what makes the session survivable. The
 * original File is not kept — only the downscaled one.
 */
async function downscale(file: File, name: string): Promise<CapturedPhoto> {
    const img = await loadImage(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No se pudo procesar la imagen.');
    ctx.drawImage(img, 0, 0, w, h);

    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    if (!blob) throw new Error('No se pudo procesar la imagen.');
    const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    canvas.width = 0;
    canvas.height = 0;

    return { id: newId(), dataUrl, file: new File([blob], name, { type: 'image/jpeg' }) };
}

/**
 * "Agregar foto" fronting a hidden file input. No `capture` attribute on
 * purpose: on iOS it forces the camera and hides the photo library; without
 * it the person gets both.
 */
export default function PhotoCapture({ label, photos, onChange, max = 4, disabled = false, hint }: {
    label: string;
    photos: CapturedPhoto[];
    onChange: (p: CapturedPhoto[]) => void;
    max?: number;
    disabled?: boolean;
    hint: string;
}) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const full = photos.length >= max;

    const handleFiles = async (list: FileList | null) => {
        if (!list || list.length === 0) return;
        const room = Math.max(0, max - photos.length);
        const picked = Array.from(list).slice(0, room);
        if (picked.length === 0) return;

        setBusy(true);
        setError(null);
        try {
            const base = slug(label);
            const added: CapturedPhoto[] = [];
            for (let i = 0; i < picked.length; i++) {
                const n = photos.length + added.length + 1;
                added.push(await downscale(picked[i], `${base}-${n}.jpg`));
            }
            onChange([...photos, ...added]);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'No se pudo agregar la foto.');
        } finally {
            setBusy(false);
            // Let the same file be picked again later.
            if (inputRef.current) inputRef.current.value = '';
        }
    };

    const remove = (id: string) => onChange(photos.filter(p => p.id !== id));

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{label}</span>
                <button
                    type="button"
                    disabled={disabled || busy || full}
                    onClick={() => inputRef.current?.click()}
                    className="btn-secondary"
                    style={{
                        minHeight: '56px', padding: '0.9rem 1.4rem', borderRadius: '8px',
                        fontSize: '1.1rem', fontWeight: 600,
                        background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)',
                        color: 'var(--text-primary)',
                        cursor: disabled || busy || full ? 'not-allowed' : 'pointer',
                        opacity: disabled || busy || full ? 0.5 : 1,
                    }}
                >
                    {busy ? 'Procesando…' : full ? `Máximo ${max}` : 'Agregar foto'}
                </button>
                <input
                    ref={inputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    disabled={disabled || busy}
                    onChange={e => handleFiles(e.target.files)}
                    style={{ display: 'none' }}
                />
            </div>

            {photos.length > 0 && (
                <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                    {photos.map(p => (
                        <div key={p.id} style={{ position: 'relative', width: '96px', height: '96px' }}>
                            <img
                                src={p.dataUrl}
                                alt=""
                                style={{ width: '96px', height: '96px', objectFit: 'cover', borderRadius: '10px', border: '1px solid var(--border)', display: 'block' }}
                            />
                            <button
                                type="button"
                                aria-label="Quitar foto"
                                disabled={disabled || busy}
                                onClick={() => remove(p.id)}
                                style={{
                                    position: 'absolute', top: '-8px', right: '-8px',
                                    width: '32px', height: '32px', borderRadius: '999px',
                                    background: 'var(--danger)', color: 'white', border: 'none',
                                    fontSize: '1.1rem', fontWeight: 700, lineHeight: 1, cursor: 'pointer',
                                }}
                            >
                                ×
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {error && <span style={{ fontSize: '0.95rem', color: 'var(--danger)' }}>{error}</span>}
            <span style={{ fontSize: '0.95rem', color: 'var(--text-secondary)' }}>{hint}</span>
        </div>
    );
}
