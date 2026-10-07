/**
 * GET /api/gbp/callback — Google redirects here with ?code=…&state=…
 * Exchanges the code, stores the refresh token, resolves the Fusionista
 * location, kicks off a first (full) sync in the background, then redirects
 * to the admin Reseñas page.
 */
import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeAndStore } from "@/lib/gbp/auth";
import { resolveAndStoreLocation } from "@/lib/gbp/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) return NextResponse.json({ error }, { status: 400 });
  if (!code || !state) return NextResponse.json({ error: "missing code/state" }, { status: 400 });

  const expected = req.cookies.get("gbp_oauth_state")?.value;
  if (!expected || expected !== state) {
    return NextResponse.json({ error: "state mismatch — restart at /api/gbp/auth" }, { status: 400 });
  }

  await exchangeCodeAndStore(code);
  const loc = await resolveAndStoreLocation();

  // No admin Reseñas page yet, so confirm here instead of redirecting to a 404.
  // Once /[locale]/resenas exists, redirect there with ?connected=1.
  const res = NextResponse.json({
    ok: true,
    connected: true,
    location: loc.title,
    next: "Run the review backfill: GET /api/gbp/sync?full=1 (Bearer CRON_SECRET) until done: true",
  });
  // Clear with the same path it was set with in /api/gbp/auth.
  res.cookies.set("gbp_oauth_state", "", { path: "/api/gbp", maxAge: 0 });
  return res;
}
