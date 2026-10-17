'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { RefreshCw } from 'lucide-react';
import { useAdmin } from '@/components/AdminContext';
import { autoSyncOnOpen, type AutoSyncResult } from '@/app/actions/autoSync';

/**
 * Pulls the latest Toast sales (and Google, hourly) without anyone pressing
 * anything: once when an admin session opens the app, and again every time
 * the app comes back to the foreground. The server decides whether a read is
 * actually due (today's figures older than 10 min, Google older than an
 * hour), so this is cheap to call. A small pill says what happened; pages
 * that show sales listen for the `fusionista:synced` event and redraw.
 */

const EVENT = 'fusionista:synced';
const MIN_GAP_MS = 60_000; // never call more often than once a minute from one device

export default function AutoSync() {
    const t = useTranslations('AutoSync');
    const { isAdmin, isLoaded } = useAdmin();
    const [state, setState] = useState<'idle' | 'running' | 'done' | 'failed'>('idle');
    const [updatedAt, setUpdatedAt] = useState<string | null>(null);
    const lastRun = useRef(0);
    const running = useRef(false);
    const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (!isLoaded || !isAdmin) return;

        const run = async () => {
            if (running.current || Date.now() - lastRun.current < MIN_GAP_MS) return;
            running.current = true;
            lastRun.current = Date.now();
            setState('running');
            let r: AutoSyncResult | null = null;
            try { r = await autoSyncOnOpen(); } catch { r = null; }
            running.current = false;
            if (!r || !r.success || r.toast === 'failed') {
                setState('failed');
            } else {
                setState('done');
                setUpdatedAt(r.toastUpdatedAt);
                if (r.toast === 'synced' || r.google === 'synced') window.dispatchEvent(new CustomEvent(EVENT, { detail: r }));
            }
            if (hideTimer.current) clearTimeout(hideTimer.current);
            hideTimer.current = setTimeout(() => setState('idle'), 4000);
        };

        void run();
        const onVisible = () => { if (document.visibilityState === 'visible') void run(); };
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('focus', onVisible);
        return () => {
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('focus', onVisible);
            if (hideTimer.current) clearTimeout(hideTimer.current);
        };
    }, [isLoaded, isAdmin]);

    if (state === 'idle') return null;

    const when = updatedAt ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(updatedAt)) : null;
    const label = state === 'running' ? t('running') : state === 'failed' ? t('failed') : when ? t('done', { time: when }) : t('doneNoTime');

    return (
        <div role="status" aria-live="polite"
            style={{ position: 'fixed', left: '50%', bottom: 'calc(1rem + env(safe-area-inset-bottom))', marginLeft: '-150px', width: '300px', zIndex: 9000,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '0.6rem 0.9rem', borderRadius: '999px',
                background: state === 'failed' ? 'var(--danger)' : 'var(--text-primary)', color: 'var(--bg-primary)', fontSize: '0.85rem', fontWeight: 600,
                boxShadow: '0 6px 20px rgba(0,0,0,0.25)', pointerEvents: 'none' }}>
            <RefreshCw size={16} className={state === 'running' ? 'an-spin' : ''} />
            {label}
            <style>{`@keyframes an-spin { 100% { transform: rotate(360deg); } } .an-spin { animation: an-spin 1s linear infinite; }`}</style>
        </div>
    );
}
