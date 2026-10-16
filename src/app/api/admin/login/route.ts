/**
 * POST /api/admin/login — unlock Admin with the password.
 *
 * The password used to be compared in the browser, which meant it shipped in
 * the JS bundle and could be read from DevTools. It now lives only in the
 * ADMIN_PASSWORD env var (Vercel + .env.local) and is compared here, in
 * constant time. On success the response sets the same `fusionista_admin`
 * cookie the client gate uses (see AdminContext / lib/adminGuard.ts).
 *
 * ADMIN_PASSWORD is read inside the handler, never at module scope
 * (Next.js evaluates routes at build time — see decisions).
 */
import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    const expected = process.env.ADMIN_PASSWORD;
    if (!expected) {
        console.error('[admin/login] ADMIN_PASSWORD is not set');
        return NextResponse.json({ error: 'not_configured' }, { status: 500 });
    }

    let password = '';
    try {
        const body = await req.json();
        password = typeof body?.password === 'string' ? body.password : '';
    } catch {
        return NextResponse.json({ error: 'bad_request' }, { status: 400 });
    }

    if (!safeEqual(password, expected)) {
        // Small fixed delay blunts brute force without hurting a real user.
        await new Promise(r => setTimeout(r, 400));
        return NextResponse.json({ error: 'invalid' }, { status: 401 });
    }

    const res = NextResponse.json({ ok: true });
    res.cookies.set('fusionista_admin', 'true', { path: '/', maxAge: 43200, sameSite: 'lax' });
    return res;
}

function safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a, 'utf8');
    const bb = Buffer.from(b, 'utf8');
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
}
