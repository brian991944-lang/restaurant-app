// GET → redirect the (admin) user to Intuit's OAuth consent screen.
// Admin-guarded: only reachable once the sidebar admin unlock has set
// the fusionista_admin cookie (see src/lib/adminGuard.ts).

import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { isAdminRequest } from "@/lib/adminGuard";

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const state = crypto.randomBytes(16).toString("hex");
  // Remember which locale the admin came from so the callback can
  // land back on the right /{locale}/finanzas page.
  const locale = req.nextUrl.searchParams.get("locale") === "es" ? "es" : "en";

  const url = new URL("https://appcenter.intuit.com/connect/oauth2");
  url.searchParams.set("client_id", process.env.QB_CLIENT_ID!);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "com.intuit.quickbooks.accounting");
  url.searchParams.set("redirect_uri", process.env.QB_REDIRECT_URI!);
  url.searchParams.set("state", state);

  const res = NextResponse.redirect(url);
  // CSRF check: callback must return the same state.
  res.cookies.set("qbo_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  res.cookies.set("qbo_oauth_locale", locale, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });
  return res;
}
