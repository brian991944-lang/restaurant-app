import { NextRequest, NextResponse } from 'next/server';

// Shared pieces of the admin passkey (fingerprint / Face ID) flow.
//
// Trust level: this unlocks the same client-side `fusionista_admin` gate the
// password does — it is a convenience for the owner's phone, not a hardened
// auth system. What it does guarantee is that only a device whose passkey was
// enrolled while already in Admin can unlock this way, and the signature is
// verified server-side against the stored public key.

export const CHALLENGE_COOKIE = 'fusionista_webauthn_challenge';
const CHALLENGE_TTL_SECONDS = 300;

/** Human name shown by the OS in the passkey sheet. */
export const RP_NAME = 'Fusionista';

/**
 * Relying party ID = the bare hostname the app is served from (Vercel domain,
 * a custom domain later, or localhost). Passkeys are bound to this, so a
 * passkey enrolled on one domain only works on that domain. Derived per
 * request rather than from an env var so no validation runs at module scope.
 */
export function rpIdFromRequest(req: NextRequest): string {
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'localhost';
    return host.split(':')[0];
}

/** Expected origin for signature verification — scheme + host, no path. */
export function originFromRequest(req: NextRequest): string {
    const explicit = req.headers.get('origin');
    if (explicit) return explicit;
    const proto = req.headers.get('x-forwarded-proto') ?? (rpIdFromRequest(req) === 'localhost' ? 'http' : 'https');
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'localhost';
    return `${proto}://${host}`;
}

/** Park the ceremony challenge in a short-lived httpOnly cookie. */
export function setChallengeCookie(res: NextResponse, challenge: string): void {
    res.cookies.set(CHALLENGE_COOKIE, challenge, {
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
        path: '/api/admin/passkey',
        maxAge: CHALLENGE_TTL_SECONDS,
    });
}

export function readChallengeCookie(req: NextRequest): string | null {
    return req.cookies.get(CHALLENGE_COOKIE)?.value ?? null;
}

export function clearChallengeCookie(res: NextResponse): void {
    res.cookies.set(CHALLENGE_COOKIE, '', { path: '/api/admin/passkey', maxAge: 0 });
}
