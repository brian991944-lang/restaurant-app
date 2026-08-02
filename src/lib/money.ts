/**
 * Money helpers for the tip module.
 *
 * Money is held as integer cents everywhere in that module. Floats are only
 * ever produced at the edges — parsing user input and rendering — so that no
 * comparison or sum is done on a value that could be 0.1 + 0.2. Every total,
 * equality check and difference goes through these functions.
 */

/**
 * Parse a user-entered amount into integer cents.
 *
 * Accepts '12.34', '$1,234.56', '12', or a number. Empty, null-ish and
 * unparseable input all yield 0 rather than NaN, so a blank field never
 * poisons a running total.
 *
 * Rounds half away from zero: 0.005 -> 1 cent, -0.005 -> -1 cent. Math.round
 * alone would round -0.5 towards zero and break symmetry on negatives.
 */
export function toCents(value: string | number): number {
    if (value === null || value === undefined) return 0;

    let n: number;
    if (typeof value === 'number') {
        n = value;
    } else {
        const cleaned = value.replace(/[$,\s]/g, '').trim();
        if (cleaned === '') return 0;
        n = Number(cleaned);
    }

    if (!Number.isFinite(n)) return 0;

    // Scale first, then round away from zero.
    const scaled = n * 100;
    return scaled < 0 ? -Math.round(-scaled) : Math.round(scaled);
}

/** Integer cents back to a decimal amount: 1234 -> 12.34. */
export function fromCents(cents: number): number {
    return cents / 100;
}

/** Integer cents as a display string: 123456 -> '$1,234.56'. */
export function formatMoney(cents: number): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
    }).format(fromCents(cents));
}

/** Sum integer cents. Stays exact because every term is already an integer. */
export function sumCents(values: number[]): number {
    return values.reduce((total, c) => total + c, 0);
}
