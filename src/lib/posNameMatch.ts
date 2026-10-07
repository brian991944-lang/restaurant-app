/**
 * Name matching between a POS (Toast) and the app's menu.
 *
 * Toast sells some dishes under a gluten-free name ("Ceviche Mixto GF"). Those
 * are the SAME dish renamed, not variants, so the GF marker is removed before
 * comparing and the match is reported as NAME_GF.
 *
 * Kept free of path aliases and TS-only syntax so a one-off Node script can
 * import it directly.
 */

const GF_PHRASES = [/\(\s*gf\s*\)/g, /\bgluten[\s-]*free\b/g, /\bsin\s+gluten\b/g, /\bgf\b/g];

/** Lowercase, no accents. */
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Normalized name plus whether a GF marker had to be removed to get it.
 * Lowercase, accents stripped, GF markers ("gf", "(gf)", "gluten free",
 * "sin gluten") and a leading "add" removed, punctuation stripped, spaces
 * collapsed.
 */
export function normalizeDetailed(name: string): { name: string; gfStripped: boolean } {
    let s = fold(name ?? '');
    let gfStripped = false;
    for (const re of GF_PHRASES) {
        const next = s.replace(re, ' ');
        if (next !== s) gfStripped = true;
        s = next;
    }
    s = s.replace(/[^a-z0-9\s]+/g, ' ').replace(/\s+/g, ' ').trim();
    s = s.replace(/^add\s+/, '');
    return { name: s, gfStripped };
}

export function normalize(name: string): string {
    return normalizeDetailed(name).name;
}

/**
 * Connective words that carry no meaning for "which dish/protein is this",
 * dropped only for token-set comparison so that "Chicken, Shrimp, and Steak"
 * equals "Add Steak, Shrimp & Chicken Mix".
 */
const FILLER = new Set(['and', 'y', 'e', 'with', 'con', 'mix', 'de', 'del', 'la', 'el', 'the', 'a', 'al']);

export function tokenSet(name: string): Set<string> {
    return new Set(normalize(name).split(' ').filter(t => t && !FILLER.has(t)));
}

export function sameTokens(a: string, b: string): boolean {
    const x = tokenSet(a), y = tokenSet(b);
    if (x.size === 0 || x.size !== y.size) return false;
    for (const t of x) if (!y.has(t)) return false;
    return true;
}

const PROTEIN = new Set([
    'pollo', 'chicken',
    'shrimp', 'camaron', 'camarones',
    'steak', 'lomo', 'beef',
    'seafood', 'mariscos',
    'mixto', 'mix',
    'pulpo',
    'pescado'
]);

/** Removals ("No Shrimp", "Sin Pollo") and doneness never consume anything. */
const NON_CONSUMING_START = /^(no|sin|without|extra|side|al lado)\b/;
const DONENESS = /\b(rare|medium|well|done|término|termino)\b/;

/**
 * True when a modifier name stands for added protein or seafood — the only
 * modifiers that move inventory. Removals, doneness and prep notes are false.
 */
export function isProteinModifier(name: string): boolean {
    const raw = fold(name ?? '').trim();
    if (NON_CONSUMING_START.test(raw) || DONENESS.test(raw)) return false;
    // Tested on the raw folded tokens so "mix" still counts here even though
    // token-set comparison ignores it.
    const tokens = raw.replace(/[^a-z0-9\s]+/g, ' ').split(/\s+/);
    return tokens.some(t => PROTEIN.has(t));
}
