'use client';

// "Vista completa en el navegador". On Android the installed app shares Chrome's
// per-site settings, so Chrome's "Desktop site" switch changes both the browser
// tab and the app. This flag does the same job from inside the app, and only
// where it should: in a browser tab the page lays out at FULL_VIEW_WIDTH (the
// desktop/tablet layout, sidebar included); the installed app (display-mode
// standalone) always keeps the device width and the phone layout. The inline
// script in [locale]/layout.tsx applies it before the first paint.

const KEY = 'fusionista_browser_full_view';
const EVENT = 'fusionista:view-mode';
/** Wider than the 1024 px tablet breakpoint, so the full desktop layout applies. */
export const FULL_VIEW_WIDTH = 1100;
const DEVICE = 'width=device-width, initial-scale=1';

/** Opened in a normal browser tab (not the installed app). */
export function isBrowserTab(): boolean {
    try {
        return window.matchMedia('(display-mode: browser)').matches && (navigator as unknown as { standalone?: boolean }).standalone !== true;
    } catch { return false; }
}

/**
 * '1' = full view, '0' = phone view (chosen by hand). Unset: the Admin phone
 * (lib/adminDevice) gets the full view in Chrome by default; every other phone
 * keeps the phone layout.
 */
export function isFullViewPreferred(): boolean {
    try {
        const v = localStorage.getItem(KEY);
        if (v === '1') return true;
        if (v === '0') return false;
        return localStorage.getItem('fusionista_admin_device') === '1';
    } catch { return false; }
}

/** True when this page is currently laid out in the full view. */
export function isFullViewActive(): boolean {
    return isFullViewPreferred() && isBrowserTab();
}

/** Writes the viewport the current context should have (idempotent). */
export function applyViewMode(): void {
    try {
        // Next emits more than one viewport tag (root + locale layouts); the browser uses the last, so set them all.
        const want = isFullViewActive() ? `width=${FULL_VIEW_WIDTH}` : DEVICE;
        document.querySelectorAll('meta[name="viewport"]').forEach(meta => {
            if (meta.getAttribute('content') !== want) meta.setAttribute('content', want);
        });
    } catch { /* no DOM */ }
}

export function setFullViewPreferred(on: boolean): void {
    try {
        localStorage.setItem(KEY, on ? '1' : '0');
    } catch { /* storage unavailable */ }
    applyViewMode();
    try { window.dispatchEvent(new Event(EVENT)); } catch { /* no DOM */ }
}

export function onViewModeChange(fn: () => void): () => void {
    window.addEventListener(EVENT, fn);
    return () => window.removeEventListener(EVENT, fn);
}
