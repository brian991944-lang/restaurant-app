'use client';

/**
 * Staff-only diagnostics for the installed menu. Opened by tapping the logo
 * five times quickly; rendered only in standalone mode, so guests on phones
 * never see it. Spanish only — this is for the floor team.
 */
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

function short(hash: string | null | undefined): string {
    return hash ? hash.slice(0, 10) : '—';
}

const SW_LABEL: Record<SyncState['serviceWorker'], string> = {
    idle: 'sin registrar',
    registering: 'registrando…',
    active: 'registrado',
    failed: 'falló el registro',
    unsupported: 'no soportado',
};

export default function StaffPanel({
    sync,
    onSyncNow,
    onClose,
}: {
    sync: SyncState | null;
    onSyncNow: () => Promise<void>;
    onClose: () => void;
}) {
    const persisted = sync?.persisted === null || sync?.persisted === undefined
        ? 'sin confirmar'
        : sync.persisted ? 'sí (persistente)' : 'NO — el sistema podría borrar la caché';
    const rows: [string, string][] = [
        ['Modo', 'app instalada (standalone)'],
        ['Conexión', sync?.online ? 'en línea' : 'sin conexión'],
        ['Almacenamiento persistente', persisted],
        ['Service worker', sync ? SW_LABEL[sync.serviceWorker] : '—'],
        ['Última sincronización', formatClock(sync?.lastSyncAt)],
        ['Última descarga completa', formatClock(sync?.lastFullSyncAt)],
        ['Último intento', sync?.lastAttemptAt
            ? `${formatClock(sync.lastAttemptAt)} · ${sync.lastAttemptOk ? 'ok' : 'falló'}`
            : '—'],
        ['Sin conexión desde', sync?.offlineSince ? formatClock(sync.offlineSince) : '—'],
        ['Cambio de menú en espera', sync?.pendingDataHash
            ? 'sí — se aplica a partir de las 9:00 AM'
            : 'no'],
        ['Fecha de la última descarga (día de negocio)', sync?.lastDataSyncBusinessDate ?? '—'],
        ['Fotos y videos en caché', sync?.mediaCached === null || sync?.mediaCached === undefined ? '—' : String(sync.mediaCached)],
        ['Platos en el menú local', sync?.snapshot ? String(sync.snapshot.items.length) : '—'],
        ['dataHash', short(sync?.version?.dataHash)],
        ['soldOutHash', short(sync?.version?.soldOutHash)],
        ['forceToken', sync?.version?.forceToken ?? '—'],
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
                <div className="mp-staff-actions">
                    <button
                        className="mp-staff-btn mp-staff-btn-primary"
                        disabled={!!sync?.syncing}
                        onClick={() => { void onSyncNow(); }}
                    >
                        {sync?.syncing ? 'Sincronizando…' : 'Sincronizar ahora'}
                    </button>
                    <button className="mp-staff-btn" onClick={onClose}>Cerrar</button>
                </div>
            </div>
        </div>
    );
}
