/**
 * Standalone-mode helpers for the public menu.
 *
 * "Standalone" = the page was launched from the home-screen icon (the iPad
 * install). Everything offline — the service worker, IndexedDB, the sync
 * engine — is gated on this, so a guest opening /menu in a phone browser gets
 * the plain server-rendered page and nothing else.
 */

const SW_URL = '/menu/serwist/sw.js';
const SW_SCOPE = '/menu';

export function isStandaloneDisplay(): boolean {
    if (typeof window === 'undefined') return false;
    try {
        if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
    } catch { /* matchMedia unavailable */ }
    // iOS Safari exposes this on home-screen launches as well; keep it as a
    // belt-and-braces check for older iPadOS builds.
    return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * Register the menu service worker. Prefers window.serwist (prepared by the
 * SerwistProvider in layout.tsx with register={false}); falls back to the
 * plain API. Resolves once the registration exists — the worker may still be
 * installing at that point.
 */
export async function registerMenuServiceWorker(): Promise<'active' | 'failed' | 'unsupported'> {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return 'unsupported';
    try {
        const sw = (window as Window & { serwist?: { register: () => Promise<unknown> } }).serwist;
        if (sw) {
            await sw.register();
        } else {
            await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE, type: 'module' });
        }
        return 'active';
    } catch (e) {
        console.error('[menu] service worker registration failed:', e);
        return 'failed';
    }
}

/**
 * Browsers with a browser-driven install flow (Chromium) fire
 * beforeinstallprompt. The menu is installed deliberately by staff, never
 * offered to guests, so the prompt is suppressed everywhere. Returns a
 * disposer.
 */
export function suppressInstallPrompt(): () => void {
    if (typeof window === 'undefined') return () => {};
    const handler = (e: Event) => { e.preventDefault(); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
}

/**
 * Ask for durable storage so iPadOS does not evict the menu cache/IndexedDB
 * under pressure. Feature-detected; returns navigator.storage.persisted()
 * afterwards, or null when the API is missing.
 */
export async function requestPersistentStorage(): Promise<boolean | null> {
    if (typeof navigator === 'undefined' || !navigator.storage) return null;
    try {
        if (typeof navigator.storage.persist === 'function') {
            await navigator.storage.persist();
        }
        if (typeof navigator.storage.persisted === 'function') {
            return await navigator.storage.persisted();
        }
    } catch { /* ignore */ }
    return null;
}
