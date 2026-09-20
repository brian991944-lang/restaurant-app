// GET /api/menu/snapshot — public, no auth.
// The full guest-facing menu as JSON: { categories, items }. Filtered the same
// way as the public page (isAvailable, !hiddenInApp, category present) and
// carrying only guest fields — see src/lib/menuSnapshot.ts for the field list
// and what is deliberately excluded.
import { NextResponse } from 'next/server';
import { loadMenuSnapshot, NO_STORE_HEADERS } from '@/lib/menuSnapshot';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const snapshot = await loadMenuSnapshot();
        return NextResponse.json(snapshot, { headers: NO_STORE_HEADERS });
    } catch (e) {
        console.error('GET /api/menu/snapshot failed:', e);
        return NextResponse.json({ error: 'snapshot_unavailable' }, { status: 500, headers: NO_STORE_HEADERS });
    }
}
