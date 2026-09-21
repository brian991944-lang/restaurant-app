// Allergen vocabulary — the single source of truth for MenuItem.allergens.
//
// These nine are the major allergens US food labelling recognises (sesame was
// added by the FASTER Act in 2023). The database column is String[]; these
// keys are the only values that should ever land in it, and menuAdmin filters
// anything else out on write rather than trusting a caller. Order here is
// display order wherever allergens are rendered.
//
// This is deliberately NOT the same axis as src/lib/menuTags.ts. A tag is a
// selling point a guest may find appealing; an allergen is a fact someone may
// need in order to not be harmed. They were briefly the same field — `fish`,
// `shell` and `nut` lived in tags — and that conflation is what this column
// exists to undo: a tag is optional decoration and can be left off a dish with
// no consequence, which is not a property an allergy warning may have.
//
// NO 'use server' and NO 'use client' directive: this module is imported from
// both server actions and client components, and either directive would break
// one side of that. (Same rule as menuTags.ts — see the digest-563344333
// outage note in src/lib/reportsTab.ts for why.)

export const ALLERGENS = [
    { key: 'milk', en: 'Milk', es: 'Leche' },
    { key: 'eggs', en: 'Eggs', es: 'Huevo' },
    { key: 'fish', en: 'Fish', es: 'Pescado' },
    { key: 'shellfish', en: 'Shellfish', es: 'Mariscos' },
    { key: 'tree_nuts', en: 'Tree nuts', es: 'Frutos secos' },
    { key: 'peanuts', en: 'Peanuts', es: 'Maní' },
    { key: 'wheat', en: 'Wheat', es: 'Trigo' },
    { key: 'soy', en: 'Soy', es: 'Soya' },
    { key: 'sesame', en: 'Sesame', es: 'Ajonjolí' },
] as const;

export type AllergenKey = (typeof ALLERGENS)[number]['key'];

const KEYS = new Set<string>(ALLERGENS.map(a => a.key));

export function isAllergenKey(value: string): value is AllergenKey {
    return KEYS.has(value);
}

/** Drops unknown keys and duplicates, and returns them in display order. */
export function normalizeAllergens(values: readonly string[]): AllergenKey[] {
    const wanted = new Set(values.filter(isAllergenKey));
    return ALLERGENS.filter(a => wanted.has(a.key)).map(a => a.key);
}

export function allergenLabel(key: string, lang: 'en' | 'es'): string | null {
    const found = ALLERGENS.find(a => a.key === key);
    return found ? found[lang] : null;
}

/**
 * The three menu tags the allergen column replaces.
 *
 * They stay in the tag vocabulary so nothing breaks mid-migration, but a dish
 * that has ANY allergen recorded stops rendering them as tags — by then the
 * allergen row is saying the same thing with more precision and the authority
 * of a field that is actually maintained. A dish with no allergens recorded
 * keeps showing them, because silently dropping a fish warning from a dish
 * nobody has reviewed yet would be strictly worse than a vague one.
 */
export const TAG_TO_ALLERGEN: Record<string, AllergenKey> = {
    fish: 'fish',
    shell: 'shellfish',
    nut: 'tree_nuts',
};
