/**
 * GET /api/gbp/auth — admin-only. Redirects to Google's consent screen.
 * One-time setup (and again only if the refresh token is ever revoked).
 */
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { buildAuthUrl } from "@/lib/gbp/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Matches the app's existing (client-side) admin gate. Tighten this when the
  // server-side admin auth work lands.
  if (req.cookies.get("fusionista_admin")?.value !== "true") {
    return NextResponse.json({ error: "admin only" }, { status: 403 });
  }

  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(buildAuthUrl(state));
  res.cookies.set("gbp_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/api/gbp",
  });
  return res;
}
