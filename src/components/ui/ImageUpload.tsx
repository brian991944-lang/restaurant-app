'use client';

import React, { useState, useRef } from 'react';
import { Upload, X, Loader2 } from 'lucide-react';
import imageCompression from 'browser-image-compression';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// Create a singleton so it doesn't crash if keys are missing (just warns when attempting upload)
const supabase = supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

interface ImageUploadProps {
    onUploadComplete: (url: string) => void;
    currentUrl?: string;
    onRemove?: () => void;
    placeholder?: string;
    bucketName?: string;
}

export default function ImageUpload({
    onUploadComplete,
    currentUrl,
    onRemove,
    placeholder = 'Subir Imagen',
    bucketName = 'dishes'
}: ImageUploadProps) {
    const [isUploading, setIsUploading] = useState(false);
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

        try {
            // 1. Compress Image
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

            // Generate a unique filename
            const fileExt = 'webp';
            const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}.${fileExt}`;
            const filePath = `${fileName}`;

            // 2. Upload to Supabase Storage
            const { data, error: uploadError } = await supabase.storage
                .from(bucketName)
                .upload(filePath, compressedFile, {
                    cacheControl: '31536000',
                    upsert: false,
                    contentType: 'image/webp'
                });

            if (uploadError) {
                console.error("Supabase Upload Error:", uploadError);
                throw new Error("No se pudo subir la imagen. Verifica los permisos del bucket (debe ser Público y permitir INSERT).");
            }

            // 3. Get Public URL
            const { data: publicUrlData } = supabase.storage
                .from(bucketName)
                .getPublicUrl(filePath);

            onUploadComplete(publicUrlData.publicUrl);
        } catch (err: any) {
            console.error("Upload process failed:", err);
            setError(err.message || 'Error al procesar la imagen.');
        } finally {
            setIsUploading(false);
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
                            background: 'rgba(0,0,0,0.6)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '50%',
                            width: '28px',
                            height: '28px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            backdropFilter: 'blur(4px)'
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
                            <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Comprimiendo y subiendo...</span>
                            <style>{`
                                @keyframes spin { 100% { transform: rotate(360deg); } }
                            `}</style>
                        </>
                    ) : (
                        <>
                            <Upload size={24} color="var(--text-secondary)" style={{ marginBottom: '0.5rem' }} />
                            <span style={{ fontSize: '0.95rem', fontWeight: 500, color: 'var(--text-primary)', marginBottom: '0.2rem' }}>{placeholder}</span>
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textAlign: 'center' }}>Haz clic o arrastra una imagen. Max 5MB<br />(se comprimirá a ~200KB).</span>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
