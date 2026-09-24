// GET /api/public/menu — public, read-only feed for the Squarespace website.
//
// { generatedAt, businessDate, sections: [{ ...category, items: [...] }] }.
// Built on loadMenuSnapshot (src/lib/menuSnapshot.ts), so the filter and the
// field list are the ones the guest-facing menu already uses: items must be
// isAvailable (not 86'd in Clover) AND NOT hiddenInApp (admin hide), placed in
// an ACTIVE category, ordered by sortOrder. Every object is assembled field by
// field — never spread from a Prisma row — so cost, recipe, inventory and
// Clover fields (targetFoodCostPct, digitalRecipeId, cloverId, cloverSyncedAt,
// cloverMissingAt, hasInventoryModifiers, the legacy `category` string, and
// every relation) can never reach the payload.
//
// soldOut uses the same 5 AM New York business-day cutover as the kitchen
// (getBusinessDate in src/lib/businessDay.ts, via isSoldOut).
//
// Reachability: the next-intl middleware matcher covers only '/' and
// '/(es|en)/:path*', and the admin gate (AdminContext / fusionista_admin
// cookie) only redirects client pages, so nothing intercepts /api/public/*.
import { NextRequest, NextResponse } from 'next/server';
import { loadMenuSnapshot, type SnapshotCategory, type SnapshotItem } from '@/lib/menuSnapshot';
import { getBusinessDate } from '@/lib/businessDay';

export const dynamic = 'force-dynamic';

/** Browsers allowed to read the feed cross-origin. Exact matches only. */
const ALLOWED_ORIGINS = new Set([
    'https://fusionistarestaurant.com',
    'https://www.fusionistarestaurant.com',
    'https://fusionista-montclair-nj.squarespace.com',
]);

// Vercel's CDN caches for five minutes and serves a stale copy for up to an
// hour while it refreshes, so a burst of website visitors costs one DB read.
// `Vary: Origin` keeps the per-origin CORS header from being cached across
// origins.
const CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=3600';

function corsHeaders(req: NextRequest): Record<string, string> {
    const origin = req.headers.get('origin');
    const headers: Record<string, string> = { Vary: 'Origin' };
    if (origin && ALLOWED_ORIGINS.has(origin)) {
        headers['Access-Control-Allow-Origin'] = origin;
        headers['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
        headers['Access-Control-Allow-Headers'] = 'Accept, Content-Type';
        headers['Access-Control-Max-Age'] = '86400';
    }
    return headers;
}

export type PublicMenuItem = Omit<SnapshotItem, 'menuCategoryId'>;
export type PublicMenuSection = SnapshotCategory & { items: PublicMenuItem[] };
export type PublicMenuFeed = {
    generatedAt: string;
    businessDate: string;
    sections: PublicMenuSection[];
};

export async function OPTIONS(req: NextRequest) {
    return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export async function GET(req: NextRequest) {
    const cors = corsHeaders(req);
    try {
        const now = new Date();
        const snapshot = await loadMenuSnapshot(now);

        // Group into sections. Only active categories come back from the
        // snapshot, so an item in an inactive category is dropped here.
        const byCategory = new Map<string, PublicMenuItem[]>();
        for (const c of snapshot.categories) byCategory.set(c.id, []);
        for (const i of snapshot.items) {
            const bucket = byCategory.get(i.menuCategoryId);
            if (!bucket) continue;
            bucket.push({
                id: i.id,
                name: i.name,
                nameEn: i.nameEn,
                nameEs: i.nameEs,
                descriptionEn: i.descriptionEn,
                descriptionEs: i.descriptionEs,
                taglineEn: i.taglineEn,
                taglineEs: i.taglineEs,
                tags: i.tags,
                allergens: i.allergens,
                allergenNotesEn: i.allergenNotesEn,
                allergenNotesEs: i.allergenNotesEs,
                servedRaw: i.servedRaw,
                whyEn: i.whyEn,
                whyEs: i.whyEs,
                componentsEn: i.componentsEn,
                componentsEs: i.componentsEs,
                salePrice: i.salePrice,
                photoUrl: i.photoUrl,
                photoUrls: i.photoUrls,
                photoUrlFull: i.photoUrlFull,
                photoUrlsFull: i.photoUrlsFull,
                photoFocalX: i.photoFocalX,
                photoFocalY: i.photoFocalY,
                photoZoom: i.photoZoom,
                photoFit: i.photoFit,
                videoUrl: i.videoUrl,
                isFeatured: i.isFeatured,
                featuredRank: i.featuredRank,
                sortOrder: i.sortOrder,
                soldOut: i.soldOut,
            });
        }

        const feed: PublicMenuFeed = {
            generatedAt: now.toISOString(),
            businessDate: getBusinessDate(now),
            sections: snapshot.categories.map(c => ({
                id: c.id,
                nameEn: c.nameEn,
                nameEs: c.nameEs,
                subtitleEn: c.subtitleEn,
                subtitleEs: c.subtitleEs,
                sortOrder: c.sortOrder,
                items: byCategory.get(c.id) ?? [],
            })),
        };

        return NextResponse.json(feed, { headers: { ...cors, 'Cache-Control': CACHE_CONTROL } });
    } catch (e) {
        console.error('GET /api/public/menu failed:', e);
        return NextResponse.json(
            { error: 'menu_unavailable' },
            { status: 500, headers: { ...cors, 'Cache-Control': 'no-store' } },
        );
    }
}
