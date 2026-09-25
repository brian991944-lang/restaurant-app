// GET /api/public/reviews — public, read-only feed of recent five-star Google
// reviews for the Squarespace website.
//
// { rating, count, mapsUrl, reviews: [{ author, authorUrl, photo, rating: 5,
//   text, when, publishedAt, url }] }
//
// Source: Google Places API (New) Place Details for the restaurant's place id,
// field mask `rating,userRatingCount,googleMapsUri,reviews`. Google returns at
// most five reviews; we keep only rating === 5, sort newest first and return
// at most five.
//
// Env: GOOGLE_PLACES_API_KEY (required; never logged or returned) and
// GOOGLE_PLACE_ID (optional, defaults to Fusionista's place id). Without the
// key the route answers 503 { error } and the website block stays hidden.
//
// Caching: the Google fetch is cached in the Next data cache for six hours
// (`next: { revalidate }`), so Google is hit at most ~4×/day regardless of
// traffic. Vercel's CDN caches the response for an hour and serves a stale
// copy for up to a day while it refreshes.
//
// Reachability: the next-intl middleware matcher covers only '/' and
// '/(es|en)/:path*', and the admin gate (AdminContext / fusionista_admin
// cookie) only redirects client pages, so nothing intercepts /api/public/*.
import { NextRequest, NextResponse } from 'next/server';

/** Re-validate the route (and the cached Google fetch) every six hours. */
export const revalidate = 21600;

const DEFAULT_PLACE_ID = 'ChIJ27xhrBWrw4kR5VdNhtN7sxw';
const FIELD_MASK = 'rating,userRatingCount,googleMapsUri,reviews';
const MAX_REVIEWS = 5;

/** Browsers allowed to read the feed cross-origin. Exact matches only. */
const ALLOWED_ORIGINS = new Set([
    'https://fusionistarestaurant.com',
    'https://www.fusionistarestaurant.com',
    'https://fusionista-montclair-nj.squarespace.com',
]);

// `Vary: Origin` keeps the per-origin CORS header from being cached across
// origins.
const CACHE_CONTROL = 'public, s-maxage=3600, stale-while-revalidate=86400';

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

export type PublicReview = {
    author: string;
    authorUrl: string | null;
    photo: string | null;
    rating: 5;
    text: string;
    /** Google's relative description, e.g. "2 weeks ago". */
    when: string;
    /** ISO 8601 timestamp of the review. */
    publishedAt: string;
    /** Link to the review on Google Maps. */
    url: string | null;
};

export type PublicReviewsFeed = {
    /** Overall place rating, e.g. 4.8. */
    rating: number | null;
    /** Total number of Google ratings. */
    count: number;
    /** Link to the place on Google Maps. */
    mapsUrl: string | null;
    reviews: PublicReview[];
};

// Shape of the Places API (New) Place Details response, limited to the
// fields in FIELD_MASK.
type PlaceDetails = {
    rating?: number;
    userRatingCount?: number;
    googleMapsUri?: string;
    reviews?: Array<{
        name?: string;
        relativePublishTimeDescription?: string;
        rating?: number;
        text?: { text?: string; languageCode?: string };
        originalText?: { text?: string; languageCode?: string };
        authorAttribution?: { displayName?: string; uri?: string; photoUri?: string };
        publishTime?: string;
        googleMapsUri?: string;
    }>;
};

export async function OPTIONS(req: NextRequest) {
    return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export async function GET(req: NextRequest) {
    const cors = corsHeaders(req);

    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
        return NextResponse.json(
            { error: 'reviews_not_configured' },
            { status: 503, headers: { ...cors, 'Cache-Control': 'no-store' } },
        );
    }
    const placeId = process.env.GOOGLE_PLACE_ID || DEFAULT_PLACE_ID;

    try {
        const res = await fetch(
            `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
            {
                headers: {
                    'X-Goog-Api-Key': apiKey,
                    'X-Goog-FieldMask': FIELD_MASK,
                },
                next: { revalidate },
            },
        );

        if (!res.ok) {
            // Log status only — never the request (it carries the key).
            console.error(`GET /api/public/reviews: Google Places responded ${res.status}`);
            return NextResponse.json(
                { error: 'reviews_unavailable' },
                { status: 502, headers: { ...cors, 'Cache-Control': 'no-store' } },
            );
        }

        const place = (await res.json()) as PlaceDetails;

        const reviews: PublicReview[] = (place.reviews ?? [])
            .filter(r => r.rating === 5)
            .map(r => ({
                author: r.authorAttribution?.displayName?.trim() || 'Google user',
                authorUrl: r.authorAttribution?.uri ?? null,
                photo: r.authorAttribution?.photoUri ?? null,
                rating: 5 as const,
                text: (r.text?.text ?? r.originalText?.text ?? '').trim(),
                when: r.relativePublishTimeDescription ?? '',
                publishedAt: r.publishTime ?? '',
                url: r.googleMapsUri ?? null,
            }))
            .filter(r => r.text.length > 0)
            .sort((a, b) => Date.parse(b.publishedAt || '0') - Date.parse(a.publishedAt || '0'))
            .slice(0, MAX_REVIEWS);

        const feed: PublicReviewsFeed = {
            rating: typeof place.rating === 'number' ? place.rating : null,
            count: place.userRatingCount ?? 0,
            mapsUrl: place.googleMapsUri ?? null,
            reviews,
        };

        return NextResponse.json(feed, { headers: { ...cors, 'Cache-Control': CACHE_CONTROL } });
    } catch (e) {
        console.error('GET /api/public/reviews failed:', e instanceof Error ? e.message : e);
        return NextResponse.json(
            { error: 'reviews_unavailable' },
            { status: 502, headers: { ...cors, 'Cache-Control': 'no-store' } },
        );
    }
}
