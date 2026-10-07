/**
 * Sync jobs: reviews (incremental or resumable backfill) + daily performance
 * metrics (rolling window). Called by /api/gbp/sync (Vercel cron) — safe to
 * re-run; everything upserts.
 *
 * Vercel Hobby caps a function at 60 s, so the full backfill (~6,200 reviews,
 * ~125 API pages) runs in slices: each `?full=1` call does up to `maxPages`
 * pages, saves the page token in GbpOAuthToken.backfillCursor, and returns
 * `done: false` until the last page. Call it until `done: true`.
 */
import prisma from "@/lib/prisma";
import { iterateReviews, fetchDailyMetrics, STAR_TO_INT, type GbpReviewRaw } from "./client";

export type ReviewsSyncResult = {
  mode: "incremental" | "backfill";
  fetched: number;
  upserted: number;
  done: boolean;
  averageRating?: number;
  totalReviews?: number;
};
export type MetricsSyncResult = { days: number; rows: number };
export type SyncResult = {
  reviews: ReviewsSyncResult;
  metrics: MetricsSyncResult | null;
  startedAt: string;
  finishedAt: string;
};

/**
 * Incremental: newest-first, stop once we reach reviews older than the newest
 * `updateTime` already stored (minus a 2-day margin so edits/replies are caught).
 * Backfill (`full: true`): resume from the saved cursor, do `maxPages`, save.
 */
export async function syncReviews(opts: { full?: boolean; maxPages?: number } = {}): Promise<ReviewsSyncResult> {
  const maxPages = opts.maxPages ?? 20;
  const token = await prisma.gbpOAuthToken.findUniqueOrThrow({ where: { id: 1 } });

  let stopAt: Date | undefined;
  let startToken: string | null = null;
  const mode: ReviewsSyncResult["mode"] = opts.full ? "backfill" : "incremental";

  if (mode === "backfill") {
    startToken = token.backfillCursor ?? null;
  } else {
    const newest = await prisma.gbpReview.findFirst({ orderBy: { updateTime: "desc" }, select: { updateTime: true } });
    if (newest) stopAt = new Date(newest.updateTime.getTime() - 2 * 86_400_000);
  }

  let fetched = 0;
  let upserted = 0;
  let averageRating: number | undefined;
  let totalReviews: number | undefined;
  let lastNext: string | undefined;

  for await (const { page, averageRating: avg, totalReviewCount, nextPageToken } of iterateReviews({ stopAt, startToken, maxPages })) {
    averageRating ??= avg;
    totalReviews ??= totalReviewCount;
    fetched += page.length;
    lastNext = nextPageToken;

    // Small transactions keep the Supabase pooler happy on Vercel.
    await prisma.$transaction(
      page.map((r) => prisma.gbpReview.upsert({ where: { id: r.reviewId }, create: toRow(r), update: toRow(r) }))
    );
    upserted += page.length;
  }

  if (averageRating !== undefined && totalReviews !== undefined) {
    const today = utcDateOnly(new Date());
    await prisma.gbpRatingSnapshot.upsert({
      where: { date: today },
      create: { date: today, averageRating, totalReviews },
      update: { averageRating, totalReviews },
    });
  }

  const done = !lastNext;
  if (mode === "backfill") {
    await prisma.gbpOAuthToken.update({
      where: { id: 1 },
      data: { backfillCursor: done ? null : lastNext, backfillDone: done },
    });
  }

  return { mode, fetched, upserted, done, averageRating, totalReviews };
}

function toRow(r: GbpReviewRaw) {
  return {
    id: r.reviewId,
    name: r.name,
    reviewerName: r.reviewer?.displayName ?? null,
    reviewerPhoto: r.reviewer?.profilePhotoUrl ?? null,
    isAnonymous: !!r.reviewer?.isAnonymous,
    starRating: STAR_TO_INT[r.starRating] ?? 0,
    comment: r.comment ?? null,
    createTime: new Date(r.createTime),
    updateTime: new Date(r.updateTime),
    replyComment: r.reviewReply?.comment ?? null,
    replyTime: r.reviewReply ? new Date(r.reviewReply.updateTime) : null,
    raw: r as unknown as object,
    syncedAt: new Date(),
  };
}

/**
 * Performance metrics. Google lags ~2–3 days and backfills, so we always
 * re-pull a rolling window (default 35 days) and upsert. One API call.
 */
export async function syncMetrics(opts: { days?: number } = {}): Promise<MetricsSyncResult> {
  const days = Math.min(Math.max(opts.days ?? 35, 1), 548); // API keeps ~18 months
  const end = utcDateOnly(new Date(Date.now() - 2 * 86_400_000)); // skip the 2 most recent (incomplete) days
  const start = new Date(end.getTime() - (days - 1) * 86_400_000);

  const rows = await fetchDailyMetrics(start, end);
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    await prisma.$transaction(
      chunk.map((m) =>
        prisma.gbpDailyMetric.upsert({
          where: { date_metric: { date: m.date, metric: m.metric } },
          create: { date: m.date, metric: m.metric, value: m.value },
          update: { value: m.value, syncedAt: new Date() },
        })
      )
    );
  }
  return { days, rows: rows.length };
}

export async function runFullSync(opts: { fullReviews?: boolean; maxPages?: number; metricDays?: number; skipMetrics?: boolean } = {}): Promise<SyncResult> {
  const startedAt = new Date().toISOString();
  const reviews = await syncReviews({ full: opts.fullReviews, maxPages: opts.maxPages });
  // During a multi-slice backfill, only pull metrics on the final slice.
  const metrics = opts.skipMetrics || (opts.fullReviews && !reviews.done) ? null : await syncMetrics({ days: opts.metricDays });
  return { reviews, metrics, startedAt, finishedAt: new Date().toISOString() };
}

function utcDateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
