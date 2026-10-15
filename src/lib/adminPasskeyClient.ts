'use client';

import { startRegistration, startAuthentication, platformAuthenticatorIsAvailable } from '@simplewebauthn/browser';

// Browser side of the Admin passkey flow. Talks to /api/admin/passkey/*.
//
// `localStorage` only remembers "this device has a passkey enrolled" so the
// unlock modal can lead with the fingerprint button instead of the password.
// It is a hint, never a credential: the server decides.

const ENROLLED_KEY = 'fusionista_admin_passkey';

export function isPasskeyEnrolledHere(): boolean {
    try { return localStorage.getItem(ENROLLED_KEY) === '1'; } catch { return false; }
}

function markEnrolledHere(on: boolean): void {
    try {
        if (on) localStorage.setItem(ENROLLED_KEY, '1');
        else localStorage.removeItem(ENROLLED_KEY);
    } catch { /* storage unavailable */ }
}

/** Does this browser have a fingerprint / Face ID authenticator we can use? */
export async function passkeySupported(): Promise<boolean> {
    if (typeof window === 'undefined' || !window.PublicKeyCredential) return false;
    try { return await platformAuthenticatorIsAvailable(); } catch { return false; }
}

export type PasskeyResult = 'ok' | 'cancelled' | 'none' | 'failed';

/** Enroll this device. Caller must already be in Admin (password unlock). */
export async function enrollPasskey(): Promise<PasskeyResult> {
    try {
        const optRes = await fetch('/api/admin/passkey/register', { credentials: 'same-origin' });
        if (!optRes.ok) return 'failed';
        const options = await optRes.json();

        const response = await startRegistration({ optionsJSON: options });

        const verifyRes = await fetch('/api/admin/passkey/register', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ response, deviceName: navigator.userAgent.slice(0, 120) }),
        });
        if (!verifyRes.ok) return 'failed';
        markEnrolledHere(true);
        return 'ok';
    } catch (e) {
        if (isAbort(e)) return 'cancelled';
        // InvalidStateError = this authenticator is already enrolled; treat as done.
        if (e instanceof Error && e.name === 'InvalidStateError') { markEnrolledHere(true); return 'ok'; }
        console.error('[passkey] enroll failed:', e);
        return 'failed';
    }
}

/** Unlock Admin with this device's passkey. */
export async function unlockWithPasskey(): Promise<PasskeyResult> {
    try {
        const optRes = await fetch('/api/admin/passkey/login', { credentials: 'same-origin' });
        if (optRes.status === 404) return 'none';
        if (!optRes.ok) return 'failed';
        const options = await optRes.json();

        const response = await startAuthentication({ optionsJSON: options });

        const verifyRes = await fetch('/api/admin/passkey/login', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ response }),
        });
        if (!verifyRes.ok) return 'failed';
        markEnrolledHere(true);
        return 'ok';
    } catch (e) {
        if (isAbort(e)) return 'cancelled';
        console.error('[passkey] unlock failed:', e);
        return 'failed';
    }
}

function isAbort(e: unknown): boolean {
    return e instanceof Error && (e.name === 'NotAllowedError' || e.name === 'AbortError');
}
