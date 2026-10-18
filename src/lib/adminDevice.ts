'use client';

import { PHONE_MAX_WIDTH } from '@/components/phone/usePhone';

// "This phone is an Admin phone." A per-device flag (localStorage) that
// AdminContext sets the moment Admin is unlocked on a phone-sized screen — from
// the sidebar, the /admin lock page or a session the browser restored — and
// clears on "Salir de Admin", from Más → Ajustes, or from the lock screen's
// "use without Admin" link. While it is set the app asks for the fingerprint /
// password on every launch and whenever it comes back after
// ADMIN_RELOCK_AFTER_HIDDEN_MS in the background, whichever home-screen icon
// opened it. markAdminDevice refuses anything wider than a phone, so the kitchen
// iPad and the PCs can never be flagged and never lock on the team.

const KEY = 'fusionista_admin_device';
const EVENT = 'fusionista:admin-device';

/** Coming back to the app after this long in the background asks for the fingerprint again. */
export const ADMIN_RELOCK_AFTER_HIDDEN_MS = 15 * 60_000;
/** A page load this soon after an unlock is a reload, not a new launch: no second prompt. */
export const ADMIN_COLD_LAUNCH_GRACE_MS = 60_000;

/** Phone-sized viewport right now (the same width the bottom tabs switch on). */
export function isPhoneSized(): boolean {
    try { return window.matchMedia(`(max-width: ${PHONE_MAX_WIDTH}px)`).matches; } catch { return false; }
}

export function isAdminDevice(): boolean {
    try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

/** Flags this device as the Admin phone. Refused on tablets and PCs; returns whether it is set. */
export function markAdminDevice(): boolean {
    if (!isPhoneSized()) return false;
    try {
        if (localStorage.getItem(KEY) !== '1') {
            localStorage.setItem(KEY, '1');
            window.dispatchEvent(new Event(EVENT));
        }
        return true;
    } catch { return false; }
}

export function clearAdminDevice(): void {
    try {
        if (localStorage.getItem(KEY) !== null) {
            localStorage.removeItem(KEY);
            window.dispatchEvent(new Event(EVENT));
        }
    } catch { /* storage unavailable */ }
}

/** Runs `fn` whenever the flag changes in this tab. Returns the unsubscribe. */
export function onAdminDeviceChange(fn: () => void): () => void {
    window.addEventListener(EVENT, fn);
    return () => window.removeEventListener(EVENT, fn);
}
