/**
 * The Clover HTTP client.
 *
 * This lives in lib rather than in app/actions/clover.ts because that file is
 * marked 'use server': everything it exports becomes a callable server action,
 * so a general-purpose "fetch any Clover path" helper could not be exported
 * from it without publishing an unauthenticated proxy to the whole Clover API.
 * Route handlers and server actions both import it from here instead.
 *
 * Credentials are read per call, never at module scope, so importing this file
 * cannot fail at build time on an environment that has no Clover keys.
 */

export function requireCloverEnv(name: 'CLOVER_MERCHANT_ID' | 'CLOVER_API_TOKEN'): string {
    const value = process.env[name];
    if (!value) {
        throw new Error('Faltan las credenciales de Clover (CLOVER_MERCHANT_ID / CLOVER_API_TOKEN) en las variables de entorno');
    }
    return value;
}

/**
 * One authenticated call against the merchant's Clover API.
 *
 * Retries a 429 up to four times with a linear backoff; any other non-OK
 * response throws with the status and body, so a caller never mistakes an
 * error page for data.
 */
export async function cloverFetch(path: string, opts: RequestInit = {}) {
    const CLOVER_MERCHANT_ID = requireCloverEnv('CLOVER_MERCHANT_ID');
    const CLOVER_TOKEN = requireCloverEnv('CLOVER_API_TOKEN');
    const url = `https://api.clover.com/v3/merchants/${CLOVER_MERCHANT_ID}${path}`;
    const headers = { 'Authorization': `Bearer ${CLOVER_TOKEN}`, 'Content-Type': 'application/json' };
    for (let attempt = 1; attempt <= 4; attempt++) {
        const res = await fetch(url, { ...opts, headers });
        if (res.status === 429) {
            await new Promise(r => setTimeout(r, attempt * 2000));
            continue;
        }
        if (!res.ok) throw new Error(`Clover ${opts.method || 'GET'} ${path} -> ${res.status}: ${await res.text()}`);
        return res.json();
    }
    throw new Error(`Clover ${path}: rate limited (429) after retries`);
}
