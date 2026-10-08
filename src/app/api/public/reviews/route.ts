// GET /api/public/reviews — public, read-only feed of recent five-star Google
// reviews for the Squarespace website.
//
// { rating, count, mapsUrl, reviews: [{ author, authorUrl, photo, rating: 5,
//   text, when, publishedAt, url }] }
//
// Source, in order:
//  1. Google Business Profile (the /api/gbp OAuth connection): ONE live page
//     of the 50 most recently updated reviews, keeping five-star reviews with
//     at least MIN_TEXT_LENGTH characters, newest first by createTime, at most
//     five. This is a live call cached for six hours — it never reads the
//     stored GbpReview archive (Business Profile API policy limits storing
//     content to small, temporary amounts kept for performance).
//  2. Fallback when the profile isn't connected or Google errors: Google Places
//     API (New) Place Details, field mask `rating,userRatingCount,
//     googleMapsUri,reviews`. Google returns at most five "most relevant"
//     reviews; we keep only rating === 5, sort newest first, at most five.
// The response header X-Reviews-Source says which one answered.
//
// Env: GOOGLE_PLACES_API_KEY (fallback only; never logged or returned) and
// GOOGLE_PLACE_ID (optional, defaults to Fusionista's place id). If both
// sources fail the route answers 502/503 { error } and the website block
// stays hidden.
//
// Caching: both Google calls are cached in the Next data cache for six hours,
// so Google is hit at most ~4×/day regardless of traffic. Vercel's CDN caches
// the response for an hour and serves a stale copy for up to a day while it
// refreshes.
//
// Reachability: the next-intl middleware matcher covers only '/' and
// '/(es|en)/:path*', and the admin gate (AdminContext / fusionista_admin
// cookie) only redirects client pages, so nothing intercepts /api/public/*.
import { NextRequest, NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { fetchLatestReviewsPage, fetchLocationMapsUri, type GbpReviewRaw } from '@/lib/gbp/client';

/** Re-validate the route (and the cached Google fetch) every six hours. */
export const revalidate = 21600;

/** Shorter five-star reviews ("Great!") make thin carousel cards. */
const MIN_TEXT_LENGTH = 40;

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

/**
 * Business Profile returns non-English reviews as
 * "<original>\n\n(Translated by Google)\n<translation>" (or with the halves
 * swapped behind an "(Original)" marker). The site is English: keep the
 * translation.
 */
function englishText(comment: string): string {
    const marker = '(Translated by Google)';
    const i = comment.indexOf(marker);
    if (i === -1) return comment.trim();
    const after = comment.slice(i + marker.length);
    const original = after.indexOf('(Original)');
    const translated = (original === -1 ? after : after.slice(0, original)).trim();
    return translated || comment.slice(0, i).trim();
}

/** Google-style relative time: "3 days ago", "a week ago", "2 months ago". */
function relativeTime(iso: string, now = Date.now()): string {
    const hours = Math.max(0, Math.floor((now - Date.parse(iso)) / 3_600_000));
    const unit = (n: number, one: string, many: string) => (n === 1 ? `a ${one} ago` : `${n} ${many} ago`);
    if (hours < 1) return 'just now';
    if (hours < 24) return hours === 1 ? 'an hour ago' : `${hours} hours ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return unit(days, 'day', 'days');
    if (days < 30) return unit(Math.floor(days / 7), 'week', 'weeks');
    if (days < 365) return unit(Math.max(1, Math.floor(days / 30)), 'month', 'months');
    return unit(Math.floor(days / 365), 'year', 'years');
}

function placeReviewsUrl(): string {
    const placeId = process.env.GOOGLE_PLACE_ID || DEFAULT_PLACE_ID;
    return `https://search.google.com/local/reviews?placeid=${encodeURIComponent(placeId)}`;
}

async function buildBusinessProfileFeed(): Promise<PublicReviewsFeed> {
    const [page, mapsUri] = await Promise.all([
        fetchLatestReviewsPage(50),
        fetchLocationMapsUri().catch(() => null),
    ]);
    const mapsUrl = mapsUri ?? placeReviewsUrl();

    const reviews: PublicReview[] = (page.reviews ?? [])
        .filter((r: GbpReviewRaw) => r.starRating === 'FIVE' && r.comment)
        .map((r: GbpReviewRaw) => ({
            author: (!r.reviewer?.isAnonymous && r.reviewer?.displayName?.trim()) || 'Google user',
            authorUrl: null,
            photo: r.reviewer?.isAnonymous ? null : (r.reviewer?.profilePhotoUrl ?? null),
            rating: 5 as const,
            text: englishText(r.comment ?? ''),
            when: relativeTime(r.createTime),
            publishedAt: r.createTime,
            // Business Profile has no per-review public link; send people to
            // the place's reviews instead.
            url: mapsUrl,
        }))
        .filter(r => r.text.length >= MIN_TEXT_LENGTH)
        .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
        .slice(0, MAX_REVIEWS);

    return {
        rating: typeof page.averageRating === 'number' ? Math.round(page.averageRating * 10) / 10 : null,
        count: page.totalReviewCount ?? 0,
        mapsUrl,
        reviews,
    };
}

/** Live Business Profile call, cached six hours; a thrown error is not cached. */
const businessProfileFeed = unstable_cache(buildBusinessProfileFeed, ['public-reviews-gbp-v1'], {
    revalidate,
});

export async function OPTIONS(req: NextRequest) {
    return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export async function GET(req: NextRequest) {
    const cors = corsHeaders(req);

    // 1. Business Profile (newest reviews). Any failure falls through to Places.
    try {
        const feed = await businessProfileFeed();
        if (feed.reviews.length > 0) {
            return NextResponse.json(feed, {
                headers: { ...cors, 'Cache-Control': CACHE_CONTROL, 'X-Reviews-Source': 'business-profile' },
            });
        }
    } catch (e) {
        console.error('GET /api/public/reviews: Business Profile failed, using Places:', e instanceof Error ? e.message.slice(0, 200) : e);
    }

    // 2. Places fallback.
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

        return NextResponse.json(feed, {
            headers: { ...cors, 'Cache-Control': CACHE_CONTROL, 'X-Reviews-Source': 'places' },
        });
    } catch (e) {
        console.error('GET /api/public/reviews failed:', e instanceof Error ? e.message : e);
        return NextResponse.json(
            { error: 'reviews_unavailable' },
            { status: 502, headers: { ...cors, 'Cache-Control': 'no-store' } },
        );
    }
}
