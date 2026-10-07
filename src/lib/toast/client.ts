/**
 * Minimal Toast API client: machine-client login, a cached token, and a GET
 * helper that sends the restaurant header, throttles, and backs off on 429.
 *
 * Read-only by design — there is no POST/PUT helper here on purpose.
 *
 * Env is read inside the functions, never at module scope, so a missing
 * variable fails the call that needs it rather than the import. Neither the
 * client secret nor the access token is ever logged or put in an error.
 *
 * Kept free of path aliases and TS-only syntax so a one-off Node script can
 * import it directly.
 */

type CachedToken = { value: string; expiresAt: number };

let cached: CachedToken | null = null;
let inflight: Promise<string> | null = null;
let lastRequestAt = 0;

/** Spacing between requests. Toast's limits are per second; this stays well under. */
const MIN_INTERVAL_MS = 350;
/** Renew this long before Toast says the token expires. */
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 4;

export class ToastError extends Error {
    status: number;
    constructor(message: string, status: number) {
        super(message);
        this.name = 'ToastError';
        this.status = status;
    }
}

function config() {
    // Vercel names it TOAST_API_HOST; .env.local has TOAST_API_HOSTNAME.
    const host = (process.env.TOAST_API_HOSTNAME || process.env.TOAST_API_HOST)?.trim().replace(/\/+$/, '');
    const clientId = process.env.TOAST_CLIENT_ID?.trim();
    const clientSecret = process.env.TOAST_CLIENT_SECRET?.trim();
    const restaurantGuid = process.env.TOAST_RESTAURANT_GUID?.trim();
    if (!host || !clientId || !clientSecret || !restaurantGuid) {
        throw new ToastError('Faltan las variables de entorno de Toast.', 0);
    }
    const base = host.startsWith('http') ? host : `https://${host}`;
    return { base, clientId, clientSecret, restaurantGuid };
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function throttle() {
    const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
}

async function login(): Promise<string> {
    const { base, clientId, clientSecret } = config();
    await throttle();
    const res = await fetch(`${base}/authentication/v1/authentication/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, clientSecret, userAccessType: 'TOAST_MACHINE_CLIENT' }),
        cache: 'no-store'
    });
    const body = await res.json().catch(() => null);
    const token = body?.token?.accessToken;
    if (!res.ok || typeof token !== 'string') {
        throw new ToastError(`No se pudo iniciar sesión en Toast (HTTP ${res.status}).`, res.status);
    }
    const expiresIn = Number(body.token.expiresIn) || 3600;
    cached = { value: token, expiresAt: Date.now() + expiresIn * 1000 - EXPIRY_MARGIN_MS };
    return token;
}

/** A valid token, reusing the cached one until shortly before it expires. */
async function getToken(): Promise<string> {
    if (cached && Date.now() < cached.expiresAt) return cached.value;
    // Concurrent callers share one login instead of each starting their own.
    inflight ??= login().finally(() => { inflight = null; });
    return inflight;
}

/**
 * GET a Toast API path (starting with '/'), parsed as JSON.
 *
 * 429: waits Retry-After (or a growing default) and retries. 401: drops the
 * cached token and retries once with a fresh one. Anything else non-2xx
 * throws a ToastError carrying the status, never the response body's secrets.
 */
export async function toastGet<T = unknown>(path: string): Promise<T> {
    const { base, restaurantGuid } = config();
    let refreshed = false;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const token = await getToken();
        await throttle();
        const res = await fetch(`${base}${path}`, {
            headers: {
                Authorization: `Bearer ${token}`,
                'Toast-Restaurant-External-ID': restaurantGuid
            },
            cache: 'no-store'
        });

        if (res.status === 429) {
            const retryAfter = Number(res.headers.get('retry-after'));
            await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1500 * (attempt + 1));
            continue;
        }
        if (res.status === 401 && !refreshed) {
            cached = null;
            refreshed = true;
            continue;
        }
        if (!res.ok) {
            throw new ToastError(`Toast respondió HTTP ${res.status} en ${path.split('?')[0]}.`, res.status);
        }
        return (await res.json()) as T;
    }
    throw new ToastError(`Toast sigue limitando las solicitudes en ${path.split('?')[0]}.`, 429);
}

const ORDERS_PAGE_SIZE = 100; // Toast's maximum for ordersBulk.
const ORDERS_MAX_PAGES = 50;

/**
 * Every order for one Toast business date ('YYYYMMDD'), all pages.
 * `truncated` is true if the page cap was hit before the last page.
 */
export async function fetchToastOrders(businessDate: string): Promise<{ orders: any[]; truncated: boolean }> {
    const orders: any[] = [];
    for (let page = 1; page <= ORDERS_MAX_PAGES; page++) {
        const batch = await toastGet<any[]>(
            `/orders/v2/ordersBulk?businessDate=${businessDate}&pageSize=${ORDERS_PAGE_SIZE}&page=${page}`
        );
        const list = Array.isArray(batch) ? batch : [];
        orders.push(...list);
        if (list.length < ORDERS_PAGE_SIZE) return { orders, truncated: false };
    }
    return { orders, truncated: true };
}

/** Toast employees, reduced to the fields the app uses. */
export async function fetchToastEmployees(): Promise<{ guid: string; firstName: string; lastName: string }[]> {
    const list = await toastGet<any[]>('/labor/v1/employees');
    return (Array.isArray(list) ? list : [])
        .filter(e => typeof e?.guid === 'string')
        .map(e => ({
            guid: e.guid,
            firstName: String(e.chosenName || e.firstName || ''),
            lastName: String(e.lastName || '')
        }));
}
