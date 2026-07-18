# QuickBooks → Supabase → Power BI pipeline (Fusionista)

Why this architecture: Microsoft deprecated the native Power BI ↔ QuickBooks
Online connector (Aug 2025), so instead we sync QBO into Supabase Postgres and
let Power BI read Postgres — a first-class, fully supported connector. Bonus:
QBO data lives next to Clover POS data for joined analysis, and the same tables
power the in-app "Finanzas" pivot tab.

```
QuickBooks Online ──(OAuth2 + REST/CDC)──▶ Vercel cron /api/quickbooks/sync
                                                    │
                                                    ▼
                                          Supabase Postgres (QboTransactionLine)
                                             │                    │
                                             ▼                    ▼
                                   Power BI (Postgres      Fusionista app
                                   connector, scheduled     /admin/finanzas
                                   refresh)                 pivot tab
```

## 1. Intuit developer app (~10 min, one time)

1. Go to https://developer.intuit.com → sign in with the same Intuit account
   that owns the Fusionista QuickBooks company.
2. Create an app → select the **QuickBooks Online Accounting** API
   (`com.intuit.quickbooks.accounting` scope).
3. Under **Keys & credentials**, copy the Client ID and Client Secret.
   Start with the **Development** (sandbox) keys; switch to **Production**
   keys after testing.
4. Add the redirect URI (must match exactly, per environment):
   `https://<your-app>.vercel.app/api/quickbooks/callback`

## 2. Environment variables (Vercel + .env.local)

```
QB_CLIENT_ID=...
QB_CLIENT_SECRET=...
QB_REDIRECT_URI=https://<your-app>.vercel.app/api/quickbooks/callback
QB_ENVIRONMENT=production        # or "sandbox" while testing
CRON_SECRET=<long random string> # Vercel injects this on cron calls
```

## 3. Files in this scaffold

| File | Purpose |
|---|---|
| `prisma/qbo-models.prisma` | Models to merge into `schema.prisma`, then `prisma migrate dev -n qbo_sync` |
| `lib/quickbooks/client.ts` | OAuth token lifecycle (rotating refresh tokens!) + query helpers |
| `app/api/quickbooks/connect/route.ts` | Starts OAuth — the "Conectar QuickBooks" button |
| `app/api/quickbooks/callback/route.ts` | Handles Intuit's redirect, stores tokens |
| `app/api/quickbooks/sync/route.ts` | Daily sync: full backfill first run, CDC afterwards |
| `app/api/quickbooks/pivot/route.ts` | Aggregation endpoint for the pivot tab (whitelisted dims) |
| `app/admin/finanzas/page.tsx` | Admin "Finanzas" tab — pivot UI in Spanish |

Integration TODOs (marked in code):
- Wrap `connect`, `pivot`, and the page in the app's existing **admin guard**.
- Adjust the `@/lib/prisma` import to the app's Prisma singleton path.
- Register **Finanzas** in the admin tab navigation.
- Optionally move UI strings into `next-intl` messages.

## 4. Cron (vercel.json)

```json
{
  "crons": [{ "path": "/api/quickbooks/sync", "schedule": "0 10 * * *" }]
}
```

10:00 UTC ≈ 6 AM ET — after the app's 5 AM business-day cutover. The daily run
also keeps the QBO refresh token alive (they expire after **100 days of
disuse** and rotate on every refresh — the client persists the rotation).

Caveats worth knowing:
- **CDC looks back max 30 days.** If the cron is dead longer than that,
  delete the `QboSyncState` row to force a full re-backfill.
- The first full sync can be slow on large ledgers; `maxDuration = 300`
  requires Vercel Pro. On Hobby, trigger the first sync locally.
- QBO rate limit is ~500 requests/min per realm — the paginated
  1000-row queries stay far under it.

## 5. Power BI → Supabase

1. In Supabase: **Settings → Database → Connection info**. For Power BI use the
   **session pooler** connection (IPv4-friendly):
   host `aws-0-<region>.pooler.supabase.com`, port `5432`,
   user `postgres.<project-ref>`, database `postgres`.
2. Recommended: create a **read-only role** for Power BI instead of using
   `postgres`:
   ```sql
   create role powerbi_reader login password '<strong password>';
   grant usage on schema public to powerbi_reader;
   grant select on "QboTransactionLine", "QboAccount", "QboVendor" to powerbi_reader;
   ```
3. In Power BI Desktop: **Get Data → PostgreSQL database** → enter host/db,
   pick **Import** mode, select the `Qbo*` tables.
4. Publish, then set **scheduled refresh** in the Power BI service (cloud →
   cloud, no gateway needed since Supabase is public with SSL).

## 6. First-run checklist

1. Merge Prisma models → migrate.
2. Deploy with env vars set (sandbox first).
3. Visit `/admin/finanzas` → **Conectar QuickBooks** → approve.
4. Trigger a manual sync:
   `curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/quickbooks/sync`
5. Reload Finanzas — default view is Cuenta × Mes for Purchases + Bills
   (i.e., where the money goes, month by month).
6. Point Power BI at Supabase, build visuals on `QboTransactionLine`.
