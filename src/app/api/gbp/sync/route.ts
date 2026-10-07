/**
 * GET /api/gbp/sync — runs the reviews + metrics sync.
 *
 * Auth: `Authorization: Bearer $CRON_SECRET` (Vercel cron sends this
 * automatically when CRON_SECRET is set in the project env).
 *
 * Query params (manual runs):
 *   ?full=1          → resumable review backfill slice (see lib/gbp/sync.ts);
 *                      call repeatedly until the response says `done: true`
 *   ?maxPages=20     → API pages per call (50 reviews each). 20 ≈ 1,000 reviews,
 *                      comfortably inside the 60 s Hobby limit
 *   ?metricDays=90   → performance window (default 35, max 548)
 *
 * Daily cron run = incremental reviews (a few seconds) + 35-day metrics.
 */
import { NextRequest, NextResponse } from "next/server";
import { runFullSync } from "@/lib/gbp/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel Hobby ceiling; raise to 300 on Pro

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const fullReviews = url.searchParams.get("full") === "1";
  const maxPages = Number(url.searchParams.get("maxPages") ?? 20);
  const metricDays = Number(url.searchParams.get("metricDays") ?? 35);

  try {
    const result = await runFullSync({ fullReviews, maxPages, metricDays });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[gbp/sync] failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
