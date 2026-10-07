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
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { iterateReviews, fetchDailyMetrics, STAR_TO_INT, type GbpReviewRaw, type DailyMetric } from "./client";

// Functions run in iad1 and the database is in us-west-2, so every statement
// is a cross-country round trip (~100 ms). Per-row upserts made a 50-review
// page take ~7 s and 35 days of metrics ~40 s; these write each page/chunk
// in ONE INSERT ... ON CONFLICT statement instead.

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

    upserted += await upsertReviews(page.map(toRow));
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
  for (let i = 0; i < rows.length; i += 1000) {
    await upsertMetrics(rows.slice(i, i + 1000));
  }
  return { days, rows: rows.length };
}

type ReviewRow = ReturnType<typeof toRow>;

/** One statement per page. Returns the number of reviews written. */
async function upsertReviews(rows: ReviewRow[]): Promise<number> {
  // ON CONFLICT DO UPDATE can't touch the same row twice in one statement.
  const unique = [...new Map(rows.map((r) => [r.id, r])).values()];
  if (!unique.length) return 0;
  const ts = (d: Date | null) => (d ? d.toISOString() : null);
  const values = unique.map(
    (r) => Prisma.sql`(${r.id}, ${r.name}, ${r.reviewerName}, ${r.reviewerPhoto}, ${r.isAnonymous},
      ${r.starRating}::int, ${r.comment}, ${ts(r.createTime)}::timestamp(3), ${ts(r.updateTime)}::timestamp(3),
      ${r.replyComment}, ${ts(r.replyTime)}::timestamp(3), ${JSON.stringify(r.raw)}::jsonb, CURRENT_TIMESTAMP)`
  );
  await prisma.$executeRaw`
    INSERT INTO "GbpReview" ("id", "name", "reviewerName", "reviewerPhoto", "isAnonymous", "starRating", "comment",
      "createTime", "updateTime", "replyComment", "replyTime", "raw", "syncedAt")
    VALUES ${Prisma.join(values)}
    ON CONFLICT ("id") DO UPDATE SET
      "name" = EXCLUDED."name",
      "reviewerName" = EXCLUDED."reviewerName",
      "reviewerPhoto" = EXCLUDED."reviewerPhoto",
      "isAnonymous" = EXCLUDED."isAnonymous",
      "starRating" = EXCLUDED."starRating",
      "comment" = EXCLUDED."comment",
      "createTime" = EXCLUDED."createTime",
      "updateTime" = EXCLUDED."updateTime",
      "replyComment" = EXCLUDED."replyComment",
      "replyTime" = EXCLUDED."replyTime",
      "raw" = EXCLUDED."raw",
      "syncedAt" = EXCLUDED."syncedAt"`;
  return unique.length;
}

/** One statement per chunk of daily metric values. */
async function upsertMetrics(rows: Array<{ date: Date; metric: DailyMetric; value: number }>): Promise<void> {
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const unique = [...new Map(rows.map((m) => [`${ymd(m.date)}|${m.metric}`, m])).values()];
  if (!unique.length) return;
  const values = unique.map(
    (m) => Prisma.sql`(${ymd(m.date)}::date, ${m.metric}, ${Math.round(m.value)}::int, CURRENT_TIMESTAMP)`
  );
  await prisma.$executeRaw`
    INSERT INTO "GbpDailyMetric" ("date", "metric", "value", "syncedAt")
    VALUES ${Prisma.join(values)}
    ON CONFLICT ("date", "metric") DO UPDATE SET
      "value" = EXCLUDED."value",
      "syncedAt" = EXCLUDED."syncedAt"`;
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
