# Clover → menu sync: dry run, 2026-09-20

Read-only pass. Nothing was written to the database, `syncMenuFromClover` was
not called, nothing was committed. This file is the only change in the
working tree.

## 0. Two things you need to know before anything else

### 0.1 The live Clover half of the simulation could NOT run from this machine

`syncMenuFromClover` reads Clover with `CLOVER_MERCHANT_ID` and
`CLOVER_API_TOKEN`. Those two variables:

- exist in Vercel only for **production** and **preview**, and are stored as
  **"sensitive"** variables (Vercel never shows them again after creation);
- are **placeholders** in the local `.env` (both values are 11 characters and
  identical — Clover answered `401 Unauthorized` to them);
- an attempt to pull the production values into a temporary file was blocked
  by the session's credential-materialization policy, and I did not try to
  work around that.

So sections 2.x below that need Clover's current catalogue (created /
adopted / updated / orphaned / skipped item lists with names) are **not
filled in**. What IS complete: the database side (every row the sync would
touch, and which of them are at risk), the field-ownership audit against the
code, and a ready-to-run script (Appendix A) that reproduces the sync's exact
read path and eligibility filter. Run it once with real credentials and it
prints every list in section 2 by name.

### 0.2 The sync has already run once — on 2026-09-17, eight minutes after it was written

The premise "the button has still never been pressed" does not match the
database:

| Evidence | Value |
|---|---|
| `ImportLog` row, `kind = CLOVER_MENU` | `importedAt = 2026-09-17T06:35:23Z` (02:35 AM New York), `rowsImported = 76` |
| Commit that introduced `syncMenuFromClover` | `9c5953b`, 2026-09-17 02:27:55 -0400 |
| `MenuItem.cloverSyncedAt` | set to 2026-09-17 on all 76 linked rows |
| `MenuCategory.cloverCategoryId` | set on all 10 categories |

The only writer of `ImportLog(kind=CLOVER_MENU)` and of `cloverSyncedAt` is
step 7 / step 6 of `syncMenuFromClover`. Local and production share the same
Supabase database, so a run from the dev machine is indistinguishable from a
button press. Either way: **the 09-17 "dry run" was a real run**, and the
current state of the 76 linked rows is what that run produced.

This changes the risk picture for a second run: it is now an *incremental*
run against rows the sync itself created, not a first import into a curated
menu.

## 1. What the code does (read path and eligibility, reproduced exactly)

Source: `src/app/actions/clover.ts`, `syncMenuFromClover`, lines 976–1229.

1. `GET /categories?limit=1000` and `GET /items?limit=1000&expand=categories`
   through `cloverFetch` (retries 429 four times, throws on any other
   non-2xx). Both lists drop `deleted === true`.
2. An item is **skipped** when, in this order: `deleted === true`;
   `hidden === true` (“oculto en Clover”); it has no category
   (“sin categoría en Clover”); `price` is 0/undefined (“precio 0 en Clover”).
   Among survivors, a second Clover item with the same trimmed,
   case-insensitive name is skipped (“nombre duplicado dentro de Clover”) —
   first one wins.
3. Only Clover categories that receive at least one eligible item are
   considered. For each: already linked by `cloverCategoryId` → reuse;
   else an existing `MenuCategory` whose `nameEn` matches case-insensitively
   **and has no `cloverCategoryId`** → link it (writes only
   `cloverCategoryId`); else → **create** with `nameEn = nameEs = Clover name`,
   `sortOrder` from Clover, subtitles null, `isActive` default true.
4. Items: linked by `cloverId` → **update** if any of `name`, `salePrice`
   (`price/100`), `menuCategoryId` (from the item's *first* Clover category),
   `isAvailable` (`available !== false`) or `cloverMissingAt !== null` differs,
   otherwise counted unchanged. Not linked → a row with the same trimmed,
   case-insensitive `name` and **no** `cloverId` → **adopt** (writes
   `cloverId` + the four fields; seeds `descriptionEn` only if the row has
   none). Same name but the row *is* linked to another Clover id → skipped
   with that reason. No name match → **create**.
5. **Orphans**: every DB row with a `cloverId` that is not in Clover's
   non-deleted item list (hidden and zero-price items still count as
   present) and not already flagged → `cloverMissingAt = now`,
   `isAvailable = false`.
6. Writes go in `$transaction` batches of 50; a failed batch stops the run and
   reports it, batches before it stay applied.
7. One `ImportLog` row; then `revalidateMenuPaths()`.

## 2. What pressing the button would do today

Legend: ✅ known from the database alone · ⏳ needs the Clover read (Appendix A).

### 2.1 Categories — CREATED, and curated categories left empty

✅ All 10 existing categories already carry a `cloverCategoryId`, so the
"link by English name" branch cannot fire for any of them.

| Category (nameEn) | nameEs | active | items now | cloverCategoryId |
|---|---|---|---|---|
| Ceviches And Appetizers | Ceviches And Appetizers | yes | 8 | EW1TR0NE0EF5T |
| Tapas | Tapas | yes | 5 | TVB194BQ7V0K6 |
| Drinks | Drinks | yes | 25 | RYP4RNTG97M06 |
| Entrees | Entrees | yes | 9 | 29XJ372Q1C1P4 |
| Desserts | Postres | yes | 6 | N41DBN2V028G4 |
| Daily Specials | Daily Specials | yes | 5 | GJGSBYHCFF0CP |
| Sides | Sides | yes | 9 | EC6KS9BE0EAK6 |
| Kids Menu | Menú Infantil | yes | 2 | N0D76Q8G6DDJP |
| Prix Fixe | Prix Fixe | yes | 2 | EC2X50W3X5KEA |
| Mocktails | Mocktails | yes | 6 | WXT54KZS75KW0 |

⏳ A category would be **created** only for a Clover category that (a) is not
one of the ten ids above and (b) has at least one eligible item. A curated
category would be **left empty** only if every linked item currently in it
has been moved to a different first category in Clover. Neither can be
determined without the Clover read. Note the sync never deactivates or
deletes a category, so an emptied one would still show on the public menu as
"Coming soon".

### 2.2 Items — CREATED ⏳

Any eligible Clover item whose id is not among the 76 linked ids **and**
whose name does not match one of the 12 unlinked rows in 2.3. Unknown until
the Clover read.

### 2.3 Items — ADOPTED (name collision with an unlinked row) — candidates ✅, matches ⏳

These are the only 12 rows that *can* be adopted. Adoption happens only if
Clover has an eligible item with exactly this name (trim + case-insensitive).
Both sides of a match can only be listed after the Clover read; the DB side
is here so you can eyeball it now.

| Unlinked row (name) | price | category | avail | recipe rows | notes |
|---|---|---|---|---|---|
| Chicha Morada | 6 | Drinks | true | 0 | has descriptionEn — would NOT be overwritten (seed only if empty). Clover has "Chicha Morada Glass" / "Pitcher" already linked, so a collision needs an item named exactly "Chicha Morada". |
| Huancaina Sauce (2oz) | 2 | — | true | 1 | costing row |
| Huancaina Sauce (4oz) | 4 | — | true | 1 | costing row |
| Lomo Saltado with Linguine a la Huancaina | 30 | — | true | 3 | costing row; Clover's linked dish is named "Linguine Huancaina With Lomo Saltado", different string → no collision |
| Rocoto Sauce (2oz) | 2 | — | true | 1 | costing row |
| Rocoto Sauce (4oz) | 4 | — | true | 1 | costing row |
| Tostones | 6 | — | true | 0 | "Tostones Side" is the linked one → no collision unless Clover also has plain "Tostones" |
| Uchucuta Sauce (2oz) | 2 | — | true | 0 | |
| Uchucuta Sauce (4oz) | 4 | — | true | 0 | |
| White rice | 4 | — | true | 0 | "White Rice Side" is linked; "White rice" ≠ "White Rice Side" |
| Yellow Potato Wedges and Choclo | 6 | — | true | 0 | "Yellow Potato Wedges" is linked; different string |
| Yucca Frita | 6 | — | true | 0 | "Yuca Frita Side" is linked; different spelling and string |

If adopted, a row gets: `cloverId`, `name` (re-written with Clover's casing),
`salePrice`, `menuCategoryId` (into the Clover category — for the 11 rows
with no category this is the first time they appear on the public menu),
`isAvailable` from Clover, `cloverSyncedAt`, `cloverMissingAt = null`,
and `descriptionEn` only where it is currently null. Their recipe rows are
untouched and keep hanging off the same `MenuItem.id`.

### 2.4 Items — UPDATED (before/after of the four Clover-owned fields) ⏳

All 76 linked rows are candidates; the sync rewrites a row only if at least
one of `name`, `salePrice`, `menuCategoryId`, `isAvailable` differs from
Clover today, or `cloverMissingAt` is set (none is). The last run was
2026-09-17 02:35, so the update list is exactly "what changed in Clover since
then". Appendix A prints the diff per row.

### 2.5 Items — ORPHANED ⏳

Any of the 76 `cloverId`s that Clover no longer returns at all (an item that
was merely hidden or zero-priced in Clover still counts as present and is
*not* orphaned). Today no row has `cloverMissingAt` set. An orphan gets
`isAvailable = false` and disappears from the public menu; the row, its
recipe and modifiers stay.

### 2.6 Items — SKIPPED ⏳

Printed with names and reasons by Appendix A. The reasons are fixed:
eliminado / oculto / sin categoría / precio 0 en Clover, nombre duplicado
dentro de Clover, and "el nombre ya pertenece a otro plato vinculado".

### 2.7 CRITICAL — rows currently `isAvailable = false` that the sync could flip back to true ✅ (exposure) / ⏳ (outcome)

There are **11** such rows. Every one of them is linked to Clover, was
stamped by the 09-17 run, and has `hiddenInApp = false`:

| Name | cloverId | category | recipe / modifiers |
|---|---|---|---|
| Aguaymanto Dirty Smash | KECABW65E49VC | Mocktails | 0 / 0 |
| Algarrobina “Silk” | BD4VVAG4DP7JM | Mocktails | 0 / 0 |
| Anticucho Special | 40SGDY1CM1MG8 | Daily Specials | 0 / 0 |
| Ginger Ale | Y9EWJB1ZAQYHM | Drinks | 0 / 0 |
| Lucuma Velvet | V7NW5CFWHCCB0 | Mocktails | 0 / 0 |
| Macho Style Seafood on Black Linguine | GFJVRNRBKH4DT | Daily Specials | 0 / 0 |
| Parihuela | F0W56G40SDQHR | Daily Specials | 0 / 0 |
| Passion Fruit Cheesecake | 09HER6FCQ8FS6 | Desserts | 0 / 0 |
| Pisco Sour Virgin | PVDGQFPNFXZTA | Mocktails | 0 / 0 |
| Pisco Sour Virgin with Chicha Morada | WXV8KMNS70NXR | Mocktails | 0 / 0 |
| Pisco Sour Virgin with Passionfruit | 8ESNMTKV7A674 | Mocktails | 0 / 0 |

How each would behave:

- If Clover still reports the item `available = false` → **stays false**
  (row counted unchanged unless another field moved).
- If Clover now reports it `available = true` (or omits the field) →
  **flips to true and reappears on the public menu and on every iPad's next
  full sync**.
- `hiddenInApp` is 0 on every row in the table, so **no dish is protected by
  the new eye button today**. If any of these 11 are meant to stay off the
  menu regardless of Clover, set `hiddenInApp = true` on them (new eye
  button) *before* pressing sync.

Where the `false` came from: the old eye button wrote `isAvailable`, but it
was replaced by `hiddenInApp` in the same commit that introduced the sync
(`9c5953b`), and the sync ran eight minutes later and overwrote
`isAvailable` on all 76 linked rows with Clover's flag. So for these 11 the
value is either (a) Clover's own `available = false` as of 09-17, in which
case a re-sync changes nothing unless someone un-86'd them in Clover, or
(b) set after 09-17 through the **availability checkbox that still exists in
`ItemEditorModal.tsx` (line 354, saved via `updateMenuItem` → `isAvailable`)**,
in which case a re-sync silently undoes it. That checkbox is a standing
foot-gun: it writes a Clover-owned field from the app. Recommend removing it
or re-pointing it at `hiddenInApp`.

The 12 unlinked rows are all `isAvailable = true`, so adoption cannot flip
any of them from false to true.

## 3. Field-by-field: the write path touches nothing app-owned ✅

Verified against `src/app/actions/clover.ts` lines 1062–1192. There is no
object spread from Clover data anywhere in the write path; every `data: {}`
is a literal with named keys.

| Write | Exact `data` keys written | Source lines |
|---|---|---|
| Category link | `cloverCategoryId` | 1062–1065 |
| Category create | `cloverCategoryId, nameEn, nameEs, sortOrder` | 1078–1085 |
| Item update | `name, salePrice, menuCategoryId, isAvailable, cloverSyncedAt, cloverMissingAt` | 1135–1139 |
| Item adopt | the six above + `cloverId`, plus `descriptionEn` **only** when `description && !byName.descriptionEn` | 1155–1165 |
| Item create | `name, cloverId, salePrice, menuCategoryId, isAvailable, cloverSyncedAt`, plus `descriptionEn` when Clover has one | 1171–1178 |
| Orphan | `cloverMissingAt, isAvailable` | 1188–1192 |

Protection of each app-owned field:

| Field | How it is protected |
|---|---|
| photoUrl, photoUrls, photoFocalX, photoFocalY, photoZoom, photoFit, videoUrl | Not a key in any `data` object; no spread. Never read from Clover (Clover has no such fields). |
| nameEn, nameEs | Not a key in any item write. The sync writes `name` only (Clover-owned identity); the public menu prefers `nameEn` when set. |
| descriptionEs | Not a key anywhere. |
| descriptionEn | Written only on **create** (row is new, nothing to lose) and on **adopt only if currently null** (`...(description && !byName.descriptionEn ? {...} : {})`, line 1162). Never on update. |
| whyEn, whyEs, componentsEn, componentsEs, tags, taglineEn, taglineEs | Not a key anywhere. |
| featuredRank, isFeatured | Not a key anywhere. |
| hiddenInApp | Not a key anywhere. The public menu filter is `isAvailable AND NOT hiddenInApp`, so a row hidden here stays hidden whatever Clover says. |
| soldOutAt | Not a key anywhere (added 2026-09-20; the sync's `select` on line 1097 does not even read it). |
| targetFoodCostPct, hasInventoryModifiers, digitalRecipeId | Not a key anywhere. |
| Recipes (`RecipeIngredient`), modifiers (`MenuItemModifier`) | No `prisma.recipeIngredient` / `prisma.menuItemModifier` call in the function; no nested writes; no `delete` of any kind (rows are never deleted, line 1181 comment and code). |
| MenuCategory nameEn/nameEs/subtitleEn/subtitleEs/sortOrder/isActive | Written only on **create** of a brand-new category (1078–1085); the link branch writes `cloverCategoryId` alone; existing categories are never updated. |

One deliberate exception to be aware of, not a leak: `name` on a linked row
is rewritten to Clover's current spelling on every update. If someone
"fixed" a dish name in the admin `name` field (not `nameEn`), Clover wins.
`nameEn` is the right field for a display name.

## 4. What I recommend before pressing the button

1. Run Appendix A once with real credentials (on Vercel-side env, or paste
   the two values into a shell for that one command) and read the per-name
   lists — especially 2.4 (updates) and 2.7 (flips).
2. For any of the 11 rows in 2.7 that must stay off the menu, set
   `hiddenInApp = true` first.
3. Consider removing the `isAvailable` checkbox from `ItemEditorModal.tsx`
   (or wiring it to `hiddenInApp`) so the app never again writes a
   Clover-owned field.
4. A run writes in batches of 50 inside transactions and cannot be rolled
   back as a whole; take a Supabase snapshot/backup immediately before.

## Appendix A — the simulation script (read-only)

Save as `clover-dryrun.tmp.mjs` at the repo root (so `@prisma/client` and
`dotenv` resolve), run with real credentials in the environment, then delete
it. It performs no writes: only `findMany` on `MenuCategory` / `MenuItem`,
and the two Clover `GET`s the sync uses.

```
CLOVER_MERCHANT_ID=... CLOVER_API_TOKEN=... node clover-dryrun.tmp.mjs out.json
```

```js
// READ-ONLY dry run of syncMenuFromClover (src/app/actions/clover.ts).
import dotenv from 'dotenv'; dotenv.config({ path: '.env.local' }); dotenv.config({ path: '.env' });
import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';
const prisma = new PrismaClient();

const MERCHANT = process.env.CLOVER_MERCHANT_ID;
const TOKEN = process.env.CLOVER_API_TOKEN;
if (!MERCHANT || !TOKEN) throw new Error('Faltan CLOVER_MERCHANT_ID / CLOVER_API_TOKEN');

async function cloverFetch(path) {
    const url = `https://api.clover.com/v3/merchants/${MERCHANT}${path}`;
    for (let attempt = 1; attempt <= 4; attempt++) {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } });
        if (res.status === 429) { await new Promise(r => setTimeout(r, attempt * 2000)); continue; }
        if (!res.ok) throw new Error(`Clover GET ${path} -> ${res.status}: ${await res.text()}`);
        return res.json();
    }
    throw new Error(`Clover ${path}: rate limited (429) after retries`);
}

function itemSkipReason(el) {
    if (el.deleted === true) return 'eliminado en Clover';
    if (el.hidden === true) return 'oculto en Clover';
    if (!(el.categories?.elements?.length > 0)) return 'sin categoría en Clover';
    if (!el.price) return 'precio 0 en Clover';
    return null;
}

const [catData, itemData] = await Promise.all([
    cloverFetch('/categories?limit=1000'),
    cloverFetch('/items?limit=1000&expand=categories'),
]);
const cloverCats = (catData.elements || []).filter(c => c.deleted !== true);
const cloverItems = (itemData.elements || []).filter(i => i.deleted !== true);
const cloverCatName = new Map(cloverCats.map(c => [c.id, (c.name || '').trim()]));

const skipped = [], eligible = [];
for (const el of cloverItems) {
    const reason = itemSkipReason(el);
    if (reason) skipped.push({ name: (el.name || '').trim() || '(sin nombre)', reason, id: el.id, price: el.price });
    else eligible.push(el);
}
const seenNames = new Set(), queue = [];
for (const el of eligible) {
    const key = (el.name || '').trim().toLowerCase();
    if (seenNames.has(key)) { skipped.push({ name: (el.name || '').trim(), reason: 'nombre duplicado dentro de Clover', id: el.id }); continue; }
    seenNames.add(key); queue.push(el);
}

const usedCatIds = new Set(queue.map(el => el.categories.elements[0].id));
const dbCats = await prisma.menuCategory.findMany({ include: { _count: { select: { menuItems: true } } } });
const catByCloverId = new Map(dbCats.filter(c => c.cloverCategoryId).map(c => [c.cloverCategoryId, c]));
const catByName = new Map(dbCats.map(c => [c.nameEn.trim().toLowerCase(), c]));
const catTargets = new Map();
const catPlan = { alreadyLinked: [], wouldLink: [], wouldCreate: [] };
for (const c of cloverCats) {
    if (!usedCatIds.has(c.id)) continue;
    const name = (c.name || '').trim();
    const already = catByCloverId.get(c.id);
    if (already) { catTargets.set(c.id, already.id); catPlan.alreadyLinked.push({ name, dbNameEn: already.nameEn }); continue; }
    const byName = catByName.get(name.toLowerCase());
    if (byName && !byName.cloverCategoryId) { catTargets.set(c.id, byName.id); catPlan.wouldLink.push({ name, dbNameEn: byName.nameEn }); continue; }
    catTargets.set(c.id, `NEW:${c.id}`);
    catPlan.wouldCreate.push({ name, cloverId: c.id });
}

const dbItems = await prisma.menuItem.findMany({
    select: { id: true, name: true, cloverId: true, salePrice: true, menuCategoryId: true, isAvailable: true, descriptionEn: true, cloverMissingAt: true, hiddenInApp: true },
});
const dbCatById = new Map(dbCats.map(c => [c.id, c]));
const catLabel = id => id == null ? '(sin categoría)' : id.startsWith('NEW:') ? `NUEVA «${cloverCatName.get(id.slice(4))}»` : `«${dbCatById.get(id)?.nameEn ?? id}»`;
const itemByCloverId = new Map(dbItems.filter(i => i.cloverId).map(i => [i.cloverId, i]));
const itemByName = new Map(dbItems.map(i => [i.name.trim().toLowerCase(), i]));

const plan = { create: [], adopt: [], update: [], unchanged: [], orphan: [] };
const flips = [];
const finalCategoryOf = new Map(dbItems.map(i => [i.id, i.menuCategoryId]));
for (const el of queue) {
    const name = (el.name || '').trim(), cloverId = el.id, salePrice = el.price / 100, isAvailable = el.available !== false;
    const menuCategoryId = catTargets.get(el.categories.elements[0].id) ?? null;
    const description = typeof el.description === 'string' ? el.description.trim() : '';
    const linked = itemByCloverId.get(cloverId);
    if (linked) {
        const same = linked.name === name && linked.salePrice === salePrice && linked.menuCategoryId === menuCategoryId && linked.isAvailable === isAvailable && linked.cloverMissingAt === null;
        if (same) { plan.unchanged.push(name); continue; }
        finalCategoryOf.set(linked.id, menuCategoryId);
        const diff = {};
        if (linked.name !== name) diff.name = [linked.name, name];
        if (linked.salePrice !== salePrice) diff.salePrice = [linked.salePrice, salePrice];
        if (linked.menuCategoryId !== menuCategoryId) diff.menuCategoryId = [catLabel(linked.menuCategoryId), catLabel(menuCategoryId)];
        if (linked.isAvailable !== isAvailable) diff.isAvailable = [linked.isAvailable, isAvailable];
        if (linked.cloverMissingAt !== null) diff.cloverMissingAt = [linked.cloverMissingAt, null];
        plan.update.push({ name, hiddenInApp: linked.hiddenInApp, diff });
        if (!linked.isAvailable && isAvailable) flips.push({ via: 'update', name: linked.name, hiddenInApp: linked.hiddenInApp });
        continue;
    }
    const byName = itemByName.get(name.toLowerCase());
    if (byName) {
        if (byName.cloverId) { skipped.push({ name, reason: `el nombre ya pertenece a otro plato vinculado a Clover (${byName.cloverId})`, id: cloverId }); continue; }
        finalCategoryOf.set(byName.id, menuCategoryId);
        plan.adopt.push({ cloverName: name, dbName: byName.name,
            before: { salePrice: byName.salePrice, category: catLabel(byName.menuCategoryId), isAvailable: byName.isAvailable, descriptionEn: byName.descriptionEn },
            after: { salePrice, category: catLabel(menuCategoryId), isAvailable, descriptionEn: (description && !byName.descriptionEn) ? description : byName.descriptionEn } });
        if (!byName.isAvailable && isAvailable) flips.push({ via: 'adopt', name: byName.name, hiddenInApp: byName.hiddenInApp });
        continue;
    }
    plan.create.push({ name, salePrice, isAvailable, category: catLabel(menuCategoryId), descriptionEn: description || null });
    finalCategoryOf.set(`create:${cloverId}`, menuCategoryId);
}
const liveIds = new Set(cloverItems.map(i => i.id));
for (const o of dbItems) if (o.cloverId && !liveIds.has(o.cloverId) && !o.cloverMissingAt) plan.orphan.push({ name: o.name, cloverId: o.cloverId, isAvailableBefore: o.isAvailable });

const countAfter = new Map(dbCats.map(c => [c.id, 0]));
for (const [, catId] of finalCategoryOf) if (catId && countAfter.has(catId)) countAfter.set(catId, countAfter.get(catId) + 1);
const categoriesAfter = dbCats.map(c => ({ nameEn: c.nameEn, before: c._count.menuItems, after: countAfter.get(c.id) }));

const out = { generatedAt: new Date().toISOString(), clover: { categories: cloverCats.length, items: cloverItems.length, eligible: queue.length }, catPlan, plan, skipped, flips, categoriesAfter };
fs.writeFileSync(process.argv[2] ?? 'clover-dryrun.json', JSON.stringify(out, null, 2));
const p = (t, arr) => { console.log(`\n== ${t} (${arr.length}) ==`); for (const x of arr) console.log(' - ' + (typeof x === 'string' ? x : JSON.stringify(x))); };
p('CATEGORIES CREATED', catPlan.wouldCreate); p('CATEGORIES LINKED BY NAME', catPlan.wouldLink);
p('CATEGORY COUNTS BEFORE/AFTER', categoriesAfter.filter(c => c.before !== c.after || c.after === 0));
p('ITEMS CREATED', plan.create); p('ITEMS ADOPTED', plan.adopt); p('ITEMS UPDATED', plan.update);
p('ITEMS ORPHANED', plan.orphan); p('ITEMS SKIPPED', skipped); p('CRITICAL isAvailable false -> true', flips);
console.log(`\nunchanged: ${plan.unchanged.length}`);
await prisma.$disconnect();
```
