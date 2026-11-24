// Etiquetas — shelf-life math and text shared by the label modal, the
// Etiquetas screen and the server actions. Pure functions, no I/O.

export type LabelStorage = 'FRIDGE' | 'FREEZER';

/** Used when a product has no shelf life saved. Deliberately conservative. */
export const DEFAULT_FRIDGE_DAYS = 3;
export const DEFAULT_FREEZER_DAYS = 60;

/** Ready-to-eat food held cold must be used within 7 days, prep day included. */
export const MAX_FRIDGE_DAYS = 7;

export function shelfLifeDays(
    storage: LabelStorage,
    fridgeDays: number | null | undefined,
    freezerDays: number | null | undefined,
): number {
    if (storage === 'FRIDGE') return fridgeDays && fridgeDays > 0 ? fridgeDays : DEFAULT_FRIDGE_DAYS;
    return freezerDays && freezerDays > 0 ? freezerDays : DEFAULT_FREEZER_DAYS;
}

/**
 * Last day the product may be used.
 * Fridge: the day it is made counts as day 1, so 3 days made on Monday ends
 * Wednesday. Freezer: counted from the day after it is made.
 */
export function expiryDate(made: Date, storage: LabelStorage, days: number): Date {
    const d = new Date(made.getFullYear(), made.getMonth(), made.getDate());
    d.setDate(d.getDate() + (storage === 'FRIDGE' ? Math.max(days - 1, 0) : days));
    return d;
}

/**
 * Prep tasks are named "Product - what to do". The label shows the product
 * large and the rest small underneath, so nothing has to be retyped.
 */
export function splitLabelName(fullName: string): { main: string; sub: string | null } {
    const i = fullName.indexOf(' - ');
    if (i <= 0) return { main: fullName.trim(), sub: null };
    return { main: fullName.slice(0, i).trim(), sub: fullName.slice(i + 3).trim() || null };
}

export function formatLabelDate(d: Date, locale: 'es' | 'en'): string {
    return new Intl.DateTimeFormat(locale === 'es' ? 'es-US' : 'en-US', { weekday: 'short', day: 'numeric', month: 'short' })
        .format(d)
        .replace(/\./g, '');
}

export function formatLabelTime(d: Date, locale: 'es' | 'en'): string {
    return new Intl.DateTimeFormat(locale === 'es' ? 'es-US' : 'en-US', { hour: 'numeric', minute: '2-digit' }).format(d);
}
