// Intuit redirects here with ?code=...&realmId=...&state=...

import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens } from "@/lib/quickbooks/client";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const realmId = req.nextUrl.searchParams.get("realmId");
  const state = req.nextUrl.searchParams.get("state");
  const expectedState = req.cookies.get("qbo_oauth_state")?.value;
  const locale = req.cookies.get("qbo_oauth_locale")?.value === "es" ? "es" : "en";
  const finanzasUrl = (qbo: string) => new URL(`/${locale}/finanzas?qbo=${qbo}`, req.url);

  if (!code || !realmId) {
    return NextResponse.redirect(finanzasUrl("error"));
  }
  if (!state || state !== expectedState) {
    return NextResponse.redirect(finanzasUrl("state_mismatch"));
  }

  try {
    await exchangeCodeForTokens(code, realmId);
    const res = NextResponse.redirect(finanzasUrl("connected"));
    res.cookies.delete("qbo_oauth_state");
    res.cookies.delete("qbo_oauth_locale");
    return res;
  } catch (err) {
    console.error("QBO callback error:", err);
    return NextResponse.redirect(finanzasUrl("error"));
  }
}
