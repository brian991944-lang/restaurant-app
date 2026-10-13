# PASS — Analytics 5: one Sync button; Toast items stored per day

**Stacks on Passes 1–4** (master at `0d14e76`). Built on top of them; `npx tsc --noEmit` and `npm run build` pass.

**This pass changes the database schema** — run it from the main PC, where `.env` has `DATABASE_URL` and `DIRECT_URL`. `git fetch` first.

One task: replace every refresh/sync button under Analytics with **one big Sincronizar button** in the Analytics header that reads Toast (figures **and now items per day**), Google Business Profile and the Clover audit, then redraws whichever dashboard is open. The "Sales in Toast" audit reads from the new item rows, so it stops being empty.

## Apply

```powershell
git fetch; git status                      # clean, master at 0d14e76
git apply --index --check analytics-5-sync.patch   # must print nothing
git apply --index analytics-5-sync.patch
npx prisma db push                         # adds PosDailyItemSales and PosDailySales.itemsComputedAt; no data loss
npx prisma generate
npm run build; npx tsc --noEmit            # both must pass; run tsc unpiped
```

`prisma db push` must report the two additions and nothing dropped. If it proposes dropping anything, stop and report.

## What the patch does

- `prisma/schema.prisma`: new `PosDailyItemSales` (one row per day × POS item, and per modifier under its item: `paidQty/paidCents`, `openQty/openCents`, `voidedQty`, `menuItemId` from the Toast mapping; unique on `(source, businessDate, kind, posItemGuid, parentPosItemGuid)`), and `PosDailySales.itemsComputedAt`.
- `src/lib/toast/dailySales.ts`: `aggregateToastDailyItems(orders, modifierKey)` — same voided/deferred rules as the day totals; an ITEM's cents are Toast's post-discount `price` (which includes its modifiers), so a day's ITEM rows add up to its checks before refunds (verified in a unit test). Modifier rows carry their own price for reference only.
- `src/lib/pos/toastDailySales.ts`: every day read now writes totals + items in one transaction (items deleted and recreated, never upserted); `readToastDailyItems`, `unreadToastDays`; `DailySalesRow.itemsComputedAt`.
- `src/app/actions/analytics.ts`: `syncAnalytics()` — Toast for today + yesterday plus up to 4 of the oldest days still missing figures or items (press again for the rest; it says how many are left), then Google (new reviews + 7 days of metrics; skipped if not connected), then the Clover audit. Each step reports separately; a 38 s budget keeps it under the Hobby ceiling. `src/lib/analytics/sync.ts` holds the result type.
- `src/app/[locale]/analytics/[view]/page.tsx`: `export const maxDuration = 60` so the action gets the plan's ceiling (default is 10 s).
- `AnalyticsShell.tsx`: the Sincronizar button (56 px, spinning icon) with a one-line status in the reader's language, and a `refreshKey` every dashboard's fetch hook depends on. `VentasNetas.tsx`: Actualizar and "Leer N días" removed; the status line now says "n días por leer con Sincronizar". `VentasView.tsx`: Clover's Sincronizar button and its `alert()` removed; the Toast audit now shows per item the paid count, "n sin cobrar", voided, and modifiers, and sits above the Clover audit.
- `src/app/actions/sales.ts`: `getToastSalesAuditData` reads `PosDailyItemSales` instead of the never-filled `PosSalesLine`.
- Catalogs: 20 `Analytics.sync_*` keys, `Sales.status_missing`, `Sales.open_qty`; 16 orphaned `Sales.*` keys removed; parity verified.
- The nightly cron and `scripts/backfill-toast-daily-sales.ts` call the same snapshot, so they write items too from now on.

## Verify in the browser

1. Analytics → any dashboard: one big **Sincronizar** button top-right; no Actualizar / Leer / Sincronizar buttons anywhere else.
2. Press it. Status should read like: `Toast: 6 días leídos · faltan 5 días: pulsa de nuevo · Google: 2 reseñas nuevas · 7 días de métricas · Clover: sin ítems nuevos · 21 s`. Press again until no "faltan" remains (11 days since go-live → 2–3 presses).
3. Ventas: the "Sales in Toast / Ventas en Toast" cards for the last 3 days now list dishes with counts and modifiers; the per-day table has no "Releer" left.
4. **Money check (important):** in Supabase run
   `select "businessDate", sum("paidCents") from "PosDailyItemSales" where kind='ITEM' group by 1 order by 1;`
   and compare with `netPaidCents` in `PosDailySales` for the same days. They should match except for refunds (items are before refunds). If items come out far higher, Toast's selection price does *not* include modifiers for this menu — report it and I'll flip the aggregation.
5. The old Google reply box on Reputación still works; the other dashboards redraw after a sync (the status line appears, tiles refresh).

## Commit and push

```
feat(analytics): one Sync button for Toast, Google and Clover; Toast items stored per day

The Analytics header gets the only refresh under the section: it reads
Toast for today and yesterday plus the oldest unread days, Google reviews
and metrics, and the Clover audit, then every dashboard redraws. Each Toast
day now also stores what sold per item and modifier (PosDailyItemSales),
which the Toast audit reads instead of the never-filled PosSalesLine.
```

Stage only the files in the patch, commit, `git push origin master`, confirm the Vercel deployment is READY.
