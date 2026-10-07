/**
 * Google Business Profile — OAuth 2.0 helpers.
 *
 * Flow (one-time): /api/gbp/auth → Google consent → /api/gbp/callback stores the
 * refresh token in GbpOAuthToken (single row, id = 1).
 * After that, getAccessToken() silently refreshes as needed.
 *
 * Env vars (Vercel → restaurant-app → Settings → Environment Variables):
 *   GBP_CLIENT_ID, GBP_CLIENT_SECRET, GBP_REDIRECT_URI
 */
import prisma from "@/lib/prisma";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

/** The one scope that covers reviews, replies, location info and performance. */
export const GBP_SCOPE = "https://www.googleapis.com/auth/business.manage";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

/** Build the Google consent URL. `state` is echoed back to the callback. */
export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env("GBP_CLIENT_ID"),
    redirect_uri: env("GBP_REDIRECT_URI"),
    response_type: "code",
    scope: GBP_SCOPE,
    access_type: "offline", // → refresh_token
    prompt: "consent",      // force refresh_token even on re-auth
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
};

/** Exchange the one-time `code` for tokens and persist them. */
export async function exchangeCodeAndStore(code: string): Promise<void> {
  const body = new URLSearchParams({
    code,
    client_id: env("GBP_CLIENT_ID"),
    client_secret: env("GBP_CLIENT_SECRET"),
    redirect_uri: env("GBP_REDIRECT_URI"),
    grant_type: "authorization_code",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  const tok = (await res.json()) as TokenResponse;
  if (!tok.refresh_token) {
    throw new Error(
      "Google did not return a refresh_token. Revoke the app at myaccount.google.com/permissions and try again."
    );
  }
  const expiresAt = new Date(Date.now() + (tok.expires_in - 60) * 1000);
  await prisma.gbpOAuthToken.upsert({
    where: { id: 1 },
    create: {
      id: 1,
      refreshToken: tok.refresh_token,
      accessToken: tok.access_token,
      expiresAt,
      scope: tok.scope ?? GBP_SCOPE,
    },
    update: {
      refreshToken: tok.refresh_token,
      accessToken: tok.access_token,
      expiresAt,
      scope: tok.scope ?? GBP_SCOPE,
    },
  });
}

/** Returns a valid access token, refreshing it if it expires within 60 s. */
export async function getAccessToken(): Promise<string> {
  const row = await prisma.gbpOAuthToken.findUnique({ where: { id: 1 } });
  if (!row) throw new Error("GBP not connected yet — visit /api/gbp/auth as admin.");

  if (row.accessToken && row.expiresAt && row.expiresAt.getTime() > Date.now()) {
    return row.accessToken;
  }

  const body = new URLSearchParams({
    client_id: env("GBP_CLIENT_ID"),
    client_secret: env("GBP_CLIENT_SECRET"),
    refresh_token: row.refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    // invalid_grant = refresh token revoked/expired → needs a fresh /api/gbp/auth
    throw new Error(`Token refresh failed: ${res.status} ${text}`);
  }
  const tok = (await res.json()) as TokenResponse;
  const expiresAt = new Date(Date.now() + (tok.expires_in - 60) * 1000);
  await prisma.gbpOAuthToken.update({
    where: { id: 1 },
    data: { accessToken: tok.access_token, expiresAt },
  });
  return tok.access_token;
}

/** True once a refresh token is stored. */
export async function isConnected(): Promise<boolean> {
  const row = await prisma.gbpOAuthToken.findUnique({ where: { id: 1 }, select: { id: true } });
  return !!row;
}
