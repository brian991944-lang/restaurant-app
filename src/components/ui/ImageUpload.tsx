'use client';

import React, { useState, useRef } from 'react';
import { Upload, X, Loader2 } from 'lucide-react';
import imageCompression from 'browser-image-compression';
import { supabase } from '@/lib/supabase';

// Two-variant menu media (dualResolution). One pick by the admin produces two
// WebPs from the same source file:
//   web   1200 px longest edge, q80  — guests on phones, and the fallback for
//                                      anything that has no full copy
//   full  2400 px longest edge, q88  — the installed iPads, which are on the
//                                      house wifi and have the screen for it
// maxSizeMB is deliberately loose on both: the library treats it as a hard
// ceiling and will grind the quality down to reach it, which would silently
// undo the q80/q88 the two tiers are defined by. These ceilings only catch a
// pathological source file.
const WEB = { maxWidthOrHeight: 1200, initialQuality: 0.8, maxSizeMB: 1 };
const FULL = { maxWidthOrHeight: 2400, initialQuality: 0.88, maxSizeMB: 8 };

interface ImageUploadProps {
    /**
     * fullUrl is passed only when `dualResolution` is set — a single-resolution
     * upload calls back with one argument, exactly as before.
     */
    onUploadComplete: (url: string, fullUrl?: string) => void;
    currentUrl?: string;
    onRemove?: () => void;
    placeholder?: string;
    bucketName?: string;
    /** Store a full-res twin beside the web copy (menu photos). */
    dualResolution?: boolean;
}

export default function ImageUpload({
    onUploadComplete,
    currentUrl,
    onRemove,
    placeholder = 'Subir Imagen',
    bucketName = 'restaurant-assets',
    dualResolution = false
}: ImageUploadProps) {
    const [isUploading, setIsUploading] = useState(false);
    const [status, setStatus] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!supabase) {
            setError("Error de Configuración: Faltan las variables de entorno de Supabase.");
            return;
        }

        setIsUploading(true);
        setError(null);
        setStatus(null);

        // Both variants share one base name, so a pair is obvious in the bucket
        // (the bucket is flat — the filename is the only place to say it).
        const base = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

        const uploadWebp = async (path: string, blob: Blob): Promise<string> => {
            const { error: uploadError } = await supabase.storage
                .from(bucketName)
                .upload(path, blob, {
                    cacheControl: '31536000',
                    upsert: false,
                    contentType: 'image/webp'
                });
            if (uploadError) {
                console.error("Supabase Upload Error:", uploadError);
                throw new Error("No se pudo subir la imagen. Verifica los permisos del bucket (debe ser Público y permitir INSERT).");
            }
            return supabase.storage.from(bucketName).getPublicUrl(path).data.publicUrl;
        };

        try {
            if (dualResolution) {
                // Compressed one after the other: two web workers chewing on a
                // 12 MP phone photo at once is what makes an iPad feel stuck.
                let webFile: File;
                let fullFile: File;
                try {
                    setStatus('Preparando versión web…');
                    webFile = await imageCompression(file, { ...WEB, useWebWorker: true, fileType: 'image/webp' as any });
                    setStatus('Preparando versión de alta resolución…');
                    fullFile = await imageCompression(file, { ...FULL, useWebWorker: true, fileType: 'image/webp' as any });
                } catch (err) {
                    // No fallback to the original file here: the two variants
                    // are the whole point, and a raw HEIC uploaded as .webp
                    // would break on every tablet.
                    console.error("Compression failed:", err);
                    throw new Error("No se pudo procesar la imagen. Prueba a exportarla como JPG o PNG antes de subirla.");
                }

                setStatus('Subiendo…');
                const webUrl = await uploadWebp(`${base}-web.webp`, webFile);
                try {
                    const fullUrl = await uploadWebp(`${base}-full.webp`, fullFile);
                    onUploadComplete(webUrl, fullUrl);
                } catch (err) {
                    // Never leave half a pair behind: the row would then claim a
                    // full-res photo the iPads cannot fetch.
                    await supabase.storage.from(bucketName).remove([`${base}-web.webp`]).catch(() => {});
                    throw err;
                }
            } else {
                // Single-resolution path (recetario, plating references): the
                // original 1280 px / 300 KB behaviour, untouched.
                const options = {
                    maxSizeMB: 0.3, // Compress to max 300KB
                    maxWidthOrHeight: 1280,
                    useWebWorker: true,
                    fileType: 'image/webp' as any // Convert to highly efficient webp
                };

                let compressedFile = file;
                try {
                    // browser-image-compression types can be finicky with image/webp string, but it's supported
                    compressedFile = await imageCompression(file, options);
                } catch (err) {
                    console.warn("Compression failed, using original file", err);
                    compressedFile = file;
                }

                onUploadComplete(await uploadWebp(`${base}.webp`, compressedFile));
            }
        } catch (err: any) {
            console.error("Upload process failed:", err);
            setError(err.message || 'Error al procesar la imagen.');
        } finally {
            setIsUploading(false);
            setStatus(null);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    return (
        <div style={{ width: '100%', marginBottom: '0.5rem' }}>
            {error && (
                <div style={{ color: '#ef4444', fontSize: '0.85rem', marginBottom: '0.5rem', padding: '0.5rem', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '4px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                    {error}
                </div>
            )}

            {currentUrl ? (
                <div style={{
                    position: 'relative',
                    width: '100%',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    border: '1px solid var(--border)',
                    background: 'var(--bg-secondary)'
                }}>
                    <img src={currentUrl} alt="Uploaded" style={{ width: '100%', display: 'block', objectFit: 'contain', maxHeight: '300px' }} />
                    <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove && onRemove(); }}
                        style={{
                            position: 'absolute',
                            top: '8px',
                            right: '8px',
                            background: 'rgba(0,0,0,0.55)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '50%',
                            width: '28px',
                            height: '28px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer'
                        }}
                        title="Eliminar imagen"
                    >
                        <X size={16} />
                    </button>
                </div>
            ) : (
                <div
                    onClick={() => !isUploading && fileInputRef.current?.click()}
                    style={{
                        width: '100%',
                        padding: '1.5rem',
                        border: '2px dashed var(--border)',
                        borderRadius: '8px',
                        background: 'var(--bg-secondary)',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: isUploading ? 'not-allowed' : 'pointer',
                        transition: 'all 0.2s',
                        opacity: isUploading ? 0.7 : 1
                    }}
                    onMouseOver={(e) => {
                        if (!isUploading) {
                            e.currentTarget.style.borderColor = 'var(--accent-primary)';
                            e.currentTarget.style.background = 'rgba(59, 130, 246, 0.05)';
                        }
                    }}
                    onMouseOut={(e) => {
                        if (!isUploading) {
                            e.currentTarget.style.borderColor = 'var(--border)';
                            e.currentTarget.style.background = 'var(--bg-secondary)';
                        }
                    }}
                >
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileChange}
                        accept="image/jpeg, image/png, image/webp, image/heic"
                        style={{ display: 'none' }}
                    />

                    {isUploading ? (
                        <>
                            <Loader2 size={24} color="var(--accent-primary)" style={{ animation: 'spin 1s linear infinite', marginBottom: '0.5rem' }} />
                            <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{status ?? 'Comprimiendo y subiendo...'}</span>
                            <style>{`
                                @keyframes spin { 100% { transform: rotate(360deg); } }
                            `}</style>
                        </>
                    ) : (
                        <>
                            <Upload size={24} color="var(--text-secondary)" style={{ marginBottom: '0.5rem' }} />
                            <span style={{ fontSize: '0.95rem', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '0.2rem' }}>{placeholder}</span>
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
                                {dualResolution
                                    ? <>Haz clic o arrastra una imagen. Sube la original más grande que tengas:<br />se guardan dos versiones, una web y una de alta resolución para los iPads.</>
                                    : <>Haz clic o arrastra una imagen. Max 5MB<br />(se comprimirá a ~200KB).</>}
                            </span>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
