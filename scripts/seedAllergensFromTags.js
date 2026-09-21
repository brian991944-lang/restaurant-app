/**
 * One-time starting point for MenuItem.allergens, plus a standing audit.
 *
 * It pre-checks ONLY what an existing tag already asserts:
 *     tag fish  -> allergen fish
 *     tag shell -> allergen shellfish
 *     tag nut   -> allergen tree_nuts
 *
 * It does NOT read descriptions, names or recipes. Guessing "leche de tigre"
 * means milk, or that a dish with "crocante" has wheat, would produce an
 * allergen list that looks reviewed and is not — which is worse than an empty
 * one, because an empty one still reads as "not reviewed" to everybody.
 *
 * Only rows that currently have NO allergens are touched, so re-running it can
 * never overwrite something a human decided. Everything else it prints for
 * review.
 *
 *   node --env-file=.env scripts/seedAllergensFromTags.js          (report only)
 *   node --env-file=.env scripts/seedAllergensFromTags.js --write  (apply)
 */
const { PrismaClient } = require('@prisma/client');

const TAG_TO_ALLERGEN = { fish: 'fish', shell: 'shellfish', nut: 'tree_nuts' };
const WRITE = process.argv.includes('--write');

(async () => {
  const prisma = new PrismaClient();
  try {
    const items = await prisma.menuItem.findMany({
      select: {
        id: true, name: true, nameEn: true, tags: true, allergens: true,
        servedRaw: true, menuCategoryId: true,
        menuCategory: { select: { nameEn: true } },
      },
      orderBy: [{ menuCategoryId: 'asc' }, { sortOrder: 'asc' }],
    });

    const seeded = [];
    const alreadySet = [];
    const empty = [];

    for (const item of items) {
      if (item.allergens.length > 0) { alreadySet.push(item); continue; }
      const derived = [...new Set(item.tags.map(t => TAG_TO_ALLERGEN[t]).filter(Boolean))];
      if (derived.length > 0) seeded.push({ item, derived });
      else empty.push(item);
    }

    if (WRITE) {
      for (const { item, derived } of seeded) {
        await prisma.menuItem.update({ where: { id: item.id }, data: { allergens: derived } });
      }
    }

    const label = i => `${(i.menuCategory?.nameEn || 'sin categoría').padEnd(24)} ${i.nameEn || i.name}`;

    console.log(`\n=== ${WRITE ? 'PRE-FILLED' : 'WOULD PRE-FILL'} FROM TAGS (${seeded.length}) ===`);
    console.log('Starting point only — verify each against its recipe.\n');
    if (seeded.length === 0) console.log('  (none — no dish carries a fish / shell / nut tag)');
    for (const { item, derived } of seeded) console.log(`  ${label(item)}  ->  ${derived.join(', ')}`);

    console.log(`\n=== ALREADY HAD ALLERGENS, UNTOUCHED (${alreadySet.length}) ===`);
    if (alreadySet.length === 0) console.log('  (none)');
    for (const item of alreadySet) console.log(`  ${label(item)}  ->  ${item.allergens.join(', ')}`);

    console.log(`\n=== NO ALLERGENS SET — NEEDS REVIEW (${empty.length}) ===`);
    console.log('Empty means NOT REVIEWED, not allergen-free. Nothing renders for these.\n');
    for (const item of empty) console.log(`  ${label(item)}`);

    const raw = items.filter(i => i.servedRaw);
    console.log(`\n=== MARKED SERVED RAW (${raw.length}) ===`);
    if (raw.length === 0) console.log('  (none)');
    for (const item of raw) console.log(`  ${label(item)}`);

    console.log(`\n${items.length} dishes total. ${WRITE ? 'Wrote' : 'Would write'} ${seeded.length}.`);
    if (!WRITE) console.log('Re-run with --write to apply.');
  } finally {
    await prisma.$disconnect();
  }
})();
