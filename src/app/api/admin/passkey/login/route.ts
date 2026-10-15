/**
 * Unlock Admin with a previously enrolled passkey (fingerprint / Face ID).
 *
 *   GET  → authentication options (challenge parked in an httpOnly cookie)
 *   POST → verify the assertion; on success sets the same `fusionista_admin`
 *          cookie the password flow sets, so every existing admin guard
 *          (client AdminContext + server adminGuard) just works.
 */
import { NextRequest, NextResponse } from 'next/server';
import {
    generateAuthenticationOptions,
    verifyAuthenticationResponse,
    type AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import prisma from '@/lib/prisma';
import {
    rpIdFromRequest,
    originFromRequest,
    setChallengeCookie,
    readChallengeCookie,
    clearChallengeCookie,
} from '@/lib/webauthn';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    const passkeys = await prisma.adminPasskey.findMany({ select: { credentialId: true, transports: true } });
    if (passkeys.length === 0) {
        return NextResponse.json({ error: 'no_passkeys' }, { status: 404 });
    }

    const options = await generateAuthenticationOptions({
        rpID: rpIdFromRequest(req),
        userVerification: 'required',
        allowCredentials: passkeys.map(p => ({
            id: p.credentialId,
            transports: parseTransports(p.transports),
        })),
    });

    const res = NextResponse.json(options);
    setChallengeCookie(res, options.challenge);
    return res;
}

export async function POST(req: NextRequest) {
    const expectedChallenge = readChallengeCookie(req);
    if (!expectedChallenge) {
        return NextResponse.json({ error: 'challenge_expired' }, { status: 400 });
    }

    let body: { response: AuthenticationResponseJSON };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'bad_request' }, { status: 400 });
    }

    const passkey = await prisma.adminPasskey.findUnique({ where: { credentialId: body.response?.id ?? '' } });
    if (!passkey) {
        const res = NextResponse.json({ error: 'unknown_credential' }, { status: 400 });
        clearChallengeCookie(res);
        return res;
    }

    try {
        const verification = await verifyAuthenticationResponse({
            response: body.response,
            expectedChallenge,
            expectedOrigin: originFromRequest(req),
            expectedRPID: rpIdFromRequest(req),
            requireUserVerification: true,
            credential: {
                id: passkey.credentialId,
                publicKey: new Uint8Array(Buffer.from(passkey.publicKey, 'base64url')),
                counter: Number(passkey.counter),
                transports: parseTransports(passkey.transports),
            },
        });

        if (!verification.verified) {
            const res = NextResponse.json({ error: 'not_verified' }, { status: 401 });
            clearChallengeCookie(res);
            return res;
        }

        await prisma.adminPasskey.update({
            where: { id: passkey.id },
            data: {
                counter: BigInt(verification.authenticationInfo.newCounter),
                lastUsedAt: new Date(),
            },
        });

        const res = NextResponse.json({ ok: true });
        clearChallengeCookie(res);
        // Mirror of what AdminContext writes on the client (same name, same
        // 12 h max-age) so server-side guards see admin immediately.
        res.cookies.set('fusionista_admin', 'true', { path: '/', maxAge: 43200, sameSite: 'lax' });
        return res;
    } catch (e) {
        console.error('[passkey/login] verification failed:', e);
        const res = NextResponse.json({ error: 'verification_failed' }, { status: 401 });
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
