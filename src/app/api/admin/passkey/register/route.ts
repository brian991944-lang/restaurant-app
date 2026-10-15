/**
 * Enroll this device's fingerprint / Face ID as an Admin passkey.
 *
 *   GET  → registration options (challenge parked in an httpOnly cookie)
 *   POST → verify the attestation and store the credential
 *
 * Both require the caller to already be in Admin (`fusionista_admin` cookie,
 * i.e. they unlocked with the password first). Same trust level as every
 * other admin-only route — see lib/adminGuard.ts.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import prisma from '@/lib/prisma';
import { isAdminRequest } from '@/lib/adminGuard';
import {
    RP_NAME,
    rpIdFromRequest,
    originFromRequest,
    setChallengeCookie,
    readChallengeCookie,
    clearChallengeCookie,
} from '@/lib/webauthn';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// One logical "user" — the Fusionista admin. WebAuthn needs a stable user
// handle; it is never shown and never changes.
const ADMIN_USER_ID = new TextEncoder().encode('fusionista-admin');

export async function GET(req: NextRequest) {
    if (!isAdminRequest(req)) {
        return NextResponse.json({ error: 'admin_required' }, { status: 401 });
    }

    const existing = await prisma.adminPasskey.findMany({ select: { credentialId: true, transports: true } });

    const options = await generateRegistrationOptions({
        rpName: RP_NAME,
        rpID: rpIdFromRequest(req),
        userID: ADMIN_USER_ID,
        userName: 'admin',
        userDisplayName: 'Fusionista Admin',
        attestationType: 'none',
        // Don't re-enroll a device that already has a passkey here.
        excludeCredentials: existing.map(c => ({
            id: c.credentialId,
            transports: parseTransports(c.transports),
        })),
        authenticatorSelection: {
            // Platform = the phone's own sensor (fingerprint / Face ID), not a
            // roaming security key.
            authenticatorAttachment: 'platform',
            residentKey: 'preferred',
            userVerification: 'required',
        },
    });

    const res = NextResponse.json(options);
    setChallengeCookie(res, options.challenge);
    return res;
}

export async function POST(req: NextRequest) {
    if (!isAdminRequest(req)) {
        return NextResponse.json({ error: 'admin_required' }, { status: 401 });
    }

    const expectedChallenge = readChallengeCookie(req);
    if (!expectedChallenge) {
        return NextResponse.json({ error: 'challenge_expired' }, { status: 400 });
    }

    let body: { response: RegistrationResponseJSON; deviceName?: string };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'bad_request' }, { status: 400 });
    }

    try {
        const verification = await verifyRegistrationResponse({
            response: body.response,
            expectedChallenge,
            expectedOrigin: originFromRequest(req),
            expectedRPID: rpIdFromRequest(req),
            requireUserVerification: true,
        });

        if (!verification.verified || !verification.registrationInfo) {
            return NextResponse.json({ error: 'not_verified' }, { status: 400 });
        }

        const { credential } = verification.registrationInfo;

        await prisma.adminPasskey.create({
            data: {
                credentialId: credential.id,
                publicKey: Buffer.from(credential.publicKey).toString('base64url'),
                counter: BigInt(credential.counter),
                transports: credential.transports ? JSON.stringify(credential.transports) : null,
                deviceName: (body.deviceName ?? '').slice(0, 120) || null,
            },
        });

        const res = NextResponse.json({ ok: true });
        clearChallengeCookie(res);
        return res;
    } catch (e) {
        console.error('[passkey/register] verification failed:', e);
        const res = NextResponse.json({ error: 'verification_failed' }, { status: 400 });
        clearChallengeCookie(res);
        return res;
    }
}

function parseTransports(raw: string | null): AuthenticatorTransport[] | undefined {
    if (!raw) return undefined;
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as AuthenticatorTransport[]) : undefined;
    } catch {
        return undefined;
    }
}

type AuthenticatorTransport = 'ble' | 'cable' | 'hybrid' | 'internal' | 'nfc' | 'smart-card' | 'usb';
