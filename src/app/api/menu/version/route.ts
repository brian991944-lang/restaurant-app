// GET /api/menu/version — public, tiny.
// { dataHash, soldOutHash, forceToken, serverTime }
//   dataHash    SHA-256 of the snapshot with sold-out state excluded
//   soldOutHash SHA-256 of id + soldOut for every visible item
//   forceToken  MenuPublishState.forceToken — rotate it to force a re-download
// An offline client compares these against what it holds and only pulls
// /api/menu/snapshot or /api/menu/availability when one differs.
import { NextResponse } from 'next/server';
import { dataHashOf, getForceToken, loadMenuSnapshot, NO_STORE_HEADERS, soldOutHashOf } from '@/lib/menuSnapshot';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const now = new Date();
        const [snapshot, forceToken] = await Promise.all([loadMenuSnapshot(now), getForceToken()]);
        return NextResponse.json(
            {
                dataHash: dataHashOf(snapshot),
                soldOutHash: soldOutHashOf(snapshot),
                forceToken,
                serverTime: now.toISOString(),
            },
            { headers: NO_STORE_HEADERS },
        );
    } catch (e) {
        console.error('GET /api/menu/version failed:', e);
        return NextResponse.json({ error: 'version_unavailable' }, { status: 500, headers: NO_STORE_HEADERS });
    }
}
