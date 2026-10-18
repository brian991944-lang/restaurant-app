'use client';

// "This phone is Brian's Admin phone." A per-device flag (localStorage), set the
// first time Admin is unlocked on the /admin lock page from a phone-sized
// viewport, and cleared from Más → Ajustes. While it is set, the app locks on
// every launch — whichever home-screen icon it was opened from — so the Admin
// experience does not depend on which manifest the browser happened to install.
// Never set on tablets (the kitchen iPad must never lock on the team).

const KEY = 'fusionista_admin_device';

export function isAdminDevice(): boolean {
    try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function markAdminDevice(): void {
    try { localStorage.setItem(KEY, '1'); } catch { /* storage unavailable */ }
}

export function clearAdminDevice(): void {
    try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}
