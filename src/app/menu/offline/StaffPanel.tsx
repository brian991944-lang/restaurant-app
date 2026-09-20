'use client';

/**
 * Staff-only panel for the installed menu. Opened by tapping the header logo
 * five times quickly; rendered only in standalone mode, so guests on phones
 * never see it. Spanish only — it is read by the floor team.
 *
 * Shows only what the sync engine already knows plus navigator.storage: no
 * admin data, no auth, no links out of /menu.
 */
import { useEffect, useState } from 'react';
import type { SyncState } from './types';

export function formatClock(ts: number | null | undefined): string {
    if (!ts) return '—';
    const d = new Date(ts);
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const today = new Date();
    const sameDay = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
    if (sameDay) return time;
    return `${d.toLocaleDateString('es', { day: 'numeric', month: 'short' })} ${time}`;
}

function formatBytes(n: number | null | undefined): string {
    if (n === null || n === undefined) return '—';
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const KIND_LABEL = { full: 'completa', availability: 'disponibilidad' } as const;

export default function StaffPanel({
    sync,
    onSyncNow,
    onClose,
}: {
    sync: SyncState | null;
    onSyncNow: () => Promise<void>;
    onClose: () => void;
}) {
    // Cache size, read fresh each time the panel opens and after each sync.
    const [estimate, setEstimate] = useState<{ usage: number | null; quota: number | null } | 'unsupported' | null>(null);
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                if (typeof navigator === 'undefined' || !navigator.storage?.estimate) { setEstimate('unsupported'); return; }
                const e = await navigator.storage.estimate();
                if (!cancelled) setEstimate({ usage: e.usage ?? null, quota: e.quota ?? null });
            } catch {
                if (!cancelled) setEstimate('unsupported');
            }
        })();
        return () => { cancelled = true; };
    }, [sync?.lastSyncAt, sync?.syncing]);

    const lastSync = sync?.lastSyncAt
        ? `${formatClock(sync.lastSyncAt)}${sync.lastSyncKind ? ` (${KIND_LABEL[sync.lastSyncKind]})` : ''}`
        : 'todavía ninguna';
    const persisted = sync?.persisted === null || sync?.persisted === undefined
        ? 'sin confirmar'
        : sync.persisted ? 'sí' : 'NO — el sistema podría borrar la caché';
    const cacheSize = estimate === null
        ? 'calculando…'
        : estimate === 'unsupported'
            ? 'no disponible'
            : `${formatBytes(estimate.usage)}${estimate.quota ? ` de ${formatBytes(estimate.quota)}` : ''}`;

    const rows: [string, string][] = [
        ['Última sincronización', lastSync],
        ['Conexión', sync?.online ? 'en línea' : 'sin conexión'],
        ['Sin conexión desde', sync?.offlineSince ? formatClock(sync.offlineSince) : '—'],
        ['Almacenamiento persistente', persisted],
        ['Tamaño de la caché', cacheSize],
        ['Fotos y videos guardados', sync?.mediaCached === null || sync?.mediaCached === undefined ? '—' : String(sync.mediaCached)],
        ['Platos en el menú local', sync?.snapshot ? String(sync.snapshot.items.length) : 'usando el menú del servidor'],
        ['Cambio de menú en espera', sync?.pendingDataHash ? 'sí — se aplica a partir de las 9:00 AM' : 'no'],
        ['Último intento', sync?.lastAttemptAt
            ? `${formatClock(sync.lastAttemptAt)} · ${sync.lastAttemptOk ? 'ok' : 'falló'}`
            : '—'],
        ['Último error', sync?.lastError ?? '—'],
    ];
    return (
        <div className="mp-staff" role="dialog" aria-modal="true" aria-label="Panel de personal" onClick={onClose}>
            <div className="mp-staff-panel" onClick={(e) => e.stopPropagation()}>
                <h2 className="mp-staff-title">Panel de personal</h2>
                <dl className="mp-staff-list">
                    {rows.map(([k, v]) => (
                        <div className="mp-staff-row" key={k}>
                            <dt>{k}</dt>
                            <dd>{v}</dd>
                        </div>
                    ))}
                </dl>
                <p className="mp-staff-note">
                    Descargar ahora trae el menú completo con fotos y videos, sin esperar a las 9:00 AM.
                </p>
                <div className="mp-staff-actions">
                    <button
                        className="mp-staff-btn mp-staff-btn-primary"
                        disabled={!!sync?.syncing || sync?.online === false}
                        onClick={() => { void onSyncNow(); }}
                    >
                        {sync?.syncing ? 'Descargando…' : 'Descargar menú ahora'}
                    </button>
                    <button className="mp-staff-btn" onClick={onClose}>Cerrar</button>
                </div>
            </div>
        </div>
    );
}
