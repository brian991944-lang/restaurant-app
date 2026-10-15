'use client';

import { useEffect } from 'react';

/**
 * Registers the no-cache ops service worker (public/app-sw.js) so the admin
 * app can be installed to a phone's home screen from the browser. Renders
 * nothing. Lives in [locale]/layout.tsx only — the public /menu layout has
 * its own worker and must not pick this one up.
 */
export default function PwaRegister() {
    useEffect(() => {
        if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
        navigator.serviceWorker
            .register('/app-sw.js', { scope: '/' })
            .catch((e) => console.warn('[pwa] service worker registration failed:', e));
    }, []);
    return null;
}
