// lib/quickbooks/client.ts
// Token lifecycle + fetch helpers for the QuickBooks Online API.
//
// Env vars required:
//   QB_CLIENT_ID, QB_CLIENT_SECRET  — from the Intuit developer app
//   QB_REDIRECT_URI                 — e.g. https://<your-app>.vercel.app/api/quickbooks/callback
//   QB_ENVIRONMENT                  — "sandbox" | "production"
//
// IMPORTANT QBO facts encoded here:
//  - Access tokens last ~1 hour; refresh tokens last 100 days and ROTATE
//    on every refresh. The new refresh token MUST be persisted each time,
//    or the connection dies. The daily sync cron keeps the token alive.
//  - All requests need `minorversion` and Accept: application/json.

import prisma from '@/lib/prisma';

const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const MINOR_VERSION = "75";

export function qboApiBase(): string {
  return process.env.QB_ENVIRONMENT === "sandbox"
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
}

function basicAuthHeader(): string {
  const raw = `${process.env.QB_CLIENT_ID}:${process.env.QB_CLIENT_SECRET}`;
  return "Basic " + Buffer.from(raw).toString("base64");
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds (access token)
  x_refresh_token_expires_in: number; // seconds (refresh token)
}

async function requestTokens(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`QBO token request failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

/** Step 2 of OAuth: exchange the authorization code and persist the connection. */
export async function exchangeCodeForTokens(code: string, realmId: string) {
  const tokens = await requestTokens(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.QB_REDIRECT_URI!,
    }),
  );
  return saveTokens(realmId, tokens);
}

async function saveTokens(realmId: string, t: TokenResponse) {
  const now = Date.now();
  return prisma.qboConnection.upsert({
    where: { realmId },
    create: {
      realmId,
      accessToken: t.access_token,
      refreshToken: t.refresh_token,
      accessTokenExpiresAt: new Date(now + t.expires_in * 1000),
      refreshTokenExpiresAt: new Date(now + t.x_refresh_token_expires_in * 1000),
    },
    update: {
      accessToken: t.access_token,
      refreshToken: t.refresh_token, // rotated — always persist
      accessTokenExpiresAt: new Date(now + t.expires_in * 1000),
      refreshTokenExpiresAt: new Date(now + t.x_refresh_token_expires_in * 1000),
    },
  });
}

/** Returns a connection with a valid (non-expiring-soon) access token. */
export async function getValidConnection() {
  const conn = await prisma.qboConnection.findFirst();
  if (!conn) return null;

  const expiresSoon = conn.accessTokenExpiresAt.getTime() - Date.now() < 5 * 60 * 1000;
  if (!expiresSoon) return conn;

  const tokens = await requestTokens(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: conn.refreshToken,
    }),
  );
  return saveTokens(conn.realmId, tokens);
}

/** Low-level authenticated GET against the QBO v3 API. */
export async function qboGet(path: string, params: Record<string, string> = {}) {
  const conn = await getValidConnection();
  if (!conn) throw new Error("QuickBooks is not connected");

  const url = new URL(`${qboApiBase()}/v3/company/${conn.realmId}${path}`);
  url.searchParams.set("minorversion", MINOR_VERSION);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${conn.accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`QBO GET ${path} failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

/** Paginated QBO SQL-ish query, e.g. `select * from Purchase`. */
export async function qboQueryAll(entity: string, where = ""): Promise<any[]> {
  const pageSize = 1000;
  let start = 1;
  const out: any[] = [];
  // QBO caps MAXRESULTS at 1000; loop until a short page.
  for (;;) {
    const q = `select * from ${entity} ${where} STARTPOSITION ${start} MAXRESULTS ${pageSize}`;
    const data = await qboGet("/query", { query: q });
    const rows: any[] = data?.QueryResponse?.[entity] ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
    start += pageSize;
  }
  return out;
}
