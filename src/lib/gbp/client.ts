/**
 * Thin typed wrappers over the four Google Business Profile APIs enabled on the
 * "fusionista-website" Cloud project:
 *   - My Business Account Management   (accounts)
 *   - My Business Business Information  (locations)
 *   - Google My Business v4             (reviews + replies)
 *   - Business Profile Performance      (daily metrics)
 */
import { getAccessToken } from "./auth";
import prisma from "@/lib/prisma";

const ACCOUNTS_API = "https://mybusinessaccountmanagement.googleapis.com/v1";
const INFO_API = "https://mybusinessbusinessinformation.googleapis.com/v1";
const REVIEWS_API = "https://mybusiness.googleapis.com/v4";
const PERF_API = "https://businessprofileperformance.googleapis.com/v1";

async function gfetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    // never cache API calls in Next's fetch cache
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GBP ${init.method ?? "GET"} ${url} → ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

// ─── Accounts & locations ────────────────────────────────────────────────────

export type GbpAccount = { name: string; accountName: string; type: string };
export type GbpLocation = { name: string; title: string; storeCode?: string };

export async function listAccounts(): Promise<GbpAccount[]> {
  const data = await gfetch<{ accounts?: GbpAccount[] }>(`${ACCOUNTS_API}/accounts`);
  return data.accounts ?? [];
}

export async function listLocations(accountName: string): Promise<GbpLocation[]> {
  const qs = new URLSearchParams({ readMask: "name,title,storeCode", pageSize: "100" });
  const data = await gfetch<{ locations?: GbpLocation[] }>(
    `${INFO_API}/${accountName}/locations?${qs}`
  );
  return data.locations ?? [];
}

/**
 * Resolve and persist the account + location to sync. Picks the location whose
 * title contains "Fusionista" (there is a verified "Fusionista - Modern Peruvian
 * Cuisine" and an unverified duplicate "Fusionista" — prefer the full title).
 */
export async function resolveAndStoreLocation(): Promise<{ accountName: string; locationName: string; title: string }> {
  const accounts = await listAccounts();
  if (!accounts.length) throw new Error("No GBP accounts visible to this Google user.");

  for (const acct of accounts) {
    const locs = await listLocations(acct.name);
    const preferred =
      locs.find((l) => /modern peruvian/i.test(l.title)) ??
      locs.find((l) => /fusionista/i.test(l.title)) ??
      locs[0];
    if (preferred) {
      await prisma.gbpOAuthToken.update({
        where: { id: 1 },
        data: { accountName: acct.name, locationName: preferred.name, locationTitle: preferred.title },
      });
      return { accountName: acct.name, locationName: preferred.name, title: preferred.title };
    }
  }
  throw new Error("No locations found under any GBP account.");
}

async function requireLocation(): Promise<{ accountName: string; locationName: string }> {
  const row = await prisma.gbpOAuthToken.findUnique({ where: { id: 1 } });
  if (!row?.accountName || !row?.locationName) {
    const r = await resolveAndStoreLocation();
    return { accountName: r.accountName, locationName: r.locationName };
  }
  return { accountName: row.accountName, locationName: row.locationName };
}

// ─── Reviews (v4) ────────────────────────────────────────────────────────────

export type GbpStar = "ONE" | "TWO" | "THREE" | "FOUR" | "FIVE" | "STAR_RATING_UNSPECIFIED";
export type GbpReviewRaw = {
  name: string;
  reviewId: string;
  reviewer: { profilePhotoUrl?: string; displayName?: string; isAnonymous?: boolean };
  starRating: GbpStar;
  comment?: string;
  createTime: string;
  updateTime: string;
  reviewReply?: { comment: string; updateTime: string };
};
type ReviewsPage = {
  reviews?: GbpReviewRaw[];
  averageRating?: number;
  totalReviewCount?: number;
  nextPageToken?: string;
};

export const STAR_TO_INT: Record<GbpStar, number> = {
  ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, STAR_RATING_UNSPECIFIED: 0,
};

/**
 * Iterate reviews newest-first (by updateTime).
 *  - `stopAt`: stop once a page's oldest review is older than this (incremental sync)
 *  - `startToken`: resume from a saved page token (multi-run backfill)
 *  - `maxPages`: cap API calls per invocation (Vercel Hobby = 60 s per function)
 * The final yield carries `nextPageToken` so the caller can persist a cursor.
 */
export async function* iterateReviews(opts: { stopAt?: Date; startToken?: string | null; maxPages?: number } = {}): AsyncGenerator<{
  page: GbpReviewRaw[];
  averageRating?: number;
  totalReviewCount?: number;
  nextPageToken?: string;
}> {
  const { accountName, locationName } = await requireLocation();
  // v4 wants accounts/{a}/locations/{l}; locationName is "locations/{l}"
  const parent = `${accountName}/${locationName}`;
  let pageToken: string | undefined = opts.startToken ?? undefined;
  let pages = 0;
  const maxPages = opts.maxPages ?? Infinity;
  do {
    const qs = new URLSearchParams({ pageSize: "50", orderBy: "updateTime desc" });
    if (pageToken) qs.set("pageToken", pageToken);
    const data = await gfetch<ReviewsPage>(`${REVIEWS_API}/${parent}/reviews?${qs}`);
    const page = data.reviews ?? [];
    pages += 1;
    const oldest = page.at(-1);
    const reachedStop = !!(opts.stopAt && oldest && new Date(oldest.updateTime) < opts.stopAt);
    const next = reachedStop ? undefined : data.nextPageToken;
    yield { page, averageRating: data.averageRating, totalReviewCount: data.totalReviewCount, nextPageToken: next };
    if (reachedStop) break;
    pageToken = data.nextPageToken;
  } while (pageToken && pages < maxPages);
}

/** Post (or overwrite) the owner reply on a review. `reviewName` = GbpReview.name */
export async function replyToReview(reviewName: string, comment: string): Promise<void> {
  await gfetch(`${REVIEWS_API}/${reviewName}/reply`, {
    method: "PUT",
    body: JSON.stringify({ comment }),
  });
}

export async function deleteReviewReply(reviewName: string): Promise<void> {
  await gfetch(`${REVIEWS_API}/${reviewName}/reply`, { method: "DELETE" });
}

// ─── Performance metrics ─────────────────────────────────────────────────────

export const DAILY_METRICS = [
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
  "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
  "BUSINESS_CONVERSATIONS",
  "BUSINESS_DIRECTION_REQUESTS",
  "CALL_CLICKS",
  "WEBSITE_CLICKS",
  "BUSINESS_BOOKINGS",
  "BUSINESS_FOOD_ORDERS",
  "BUSINESS_FOOD_MENU_CLICKS",
] as const;
export type DailyMetric = (typeof DAILY_METRICS)[number];

type DatedValue = { date: { year: number; month: number; day: number }; value?: string };
type MultiDailyResponse = {
  multiDailyMetricTimeSeries?: Array<{
    dailyMetricTimeSeries?: Array<{
      dailyMetric: DailyMetric;
      timeSeries?: { datedValues?: DatedValue[] };
    }>;
  }>;
};

/** Fetch daily values for every metric in DAILY_METRICS between two dates (inclusive). */
export async function fetchDailyMetrics(start: Date, end: Date): Promise<Array<{ date: Date; metric: DailyMetric; value: number }>> {
  const { locationName } = await requireLocation(); // Performance API wants "locations/{id}"
  const qs = new URLSearchParams();
  for (const m of DAILY_METRICS) qs.append("dailyMetrics", m);
  qs.set("dailyRange.start_date.year", String(start.getUTCFullYear()));
  qs.set("dailyRange.start_date.month", String(start.getUTCMonth() + 1));
  qs.set("dailyRange.start_date.day", String(start.getUTCDate()));
  qs.set("dailyRange.end_date.year", String(end.getUTCFullYear()));
  qs.set("dailyRange.end_date.month", String(end.getUTCMonth() + 1));
  qs.set("dailyRange.end_date.day", String(end.getUTCDate()));

  const data = await gfetch<MultiDailyResponse>(
    `${PERF_API}/${locationName}:fetchMultiDailyMetricsTimeSeries?${qs}`
  );

  const out: Array<{ date: Date; metric: DailyMetric; value: number }> = [];
  for (const group of data.multiDailyMetricTimeSeries ?? []) {
    for (const series of group.dailyMetricTimeSeries ?? []) {
      for (const dv of series.timeSeries?.datedValues ?? []) {
        out.push({
          date: new Date(Date.UTC(dv.date.year, dv.date.month - 1, dv.date.day)),
          metric: series.dailyMetric,
          value: Number(dv.value ?? 0),
        });
      }
    }
  }
  return out;
}
