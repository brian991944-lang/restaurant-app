// GET /api/menu/availability — public.
// [{ id, soldOut }] for visible items only. Nothing else.
import { NextResponse } from 'next/server';
import { availabilityOf, loadMenuSnapshot, NO_STORE_HEADERS } from '@/lib/menuSnapshot';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const snapshot = await loadMenuSnapshot();
        return NextResponse.json(availabilityOf(snapshot), { headers: NO_STORE_HEADERS });
    } catch (e) {
        console.error('GET /api/menu/availability failed:', e);
        return NextResponse.json({ error: 'availability_unavailable' }, { status: 500, headers: NO_STORE_HEADERS });
    }
}
