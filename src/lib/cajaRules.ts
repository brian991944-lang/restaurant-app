/**
 * Rules for the Salón cash boxes (Caja Blanca / Caja Negra).
 *
 * Plain TypeScript, no 'use server': these are shared by the server actions
 * that judge a corte and by the client that previews one. Money is integer
 * cents throughout, as in src/lib/money.ts.
 */

/** A count is accepted as matching when it is within this many cents. */
export const TOLERANCIA_CENTS = 200;

export type CajaNivel = 'OK' | 'MENOR' | 'DESCUADRE';

/**
 * How a firm difference (contado − esperado) is judged: exact is OK, within
 * tolerance is MENOR, beyond it is DESCUADRE. Sign does not matter — a box that
 * is over by $5 is as much a finding as one that is short by $5.
 */
export function nivelFor(diffCents: number, tol: number = TOLERANCIA_CENTS): CajaNivel {
    if (diffCents === 0) return 'OK';
    return Math.abs(diffCents) <= tol ? 'MENOR' : 'DESCUADRE';
}

/**
 * Whether a Clover tender is cash.
 *
 * Clover's own cash tender carries labelKey 'com.clover.tender.cash', and
 * that key is authoritative whenever present: the live merchant also has a
 * "Cash Discount" surcharge tender (labelKey 'com.trnxn.cashdiscount') whose
 * label would otherwise match. The label regex is only a fallback for a
 * custom tender that carries no labelKey at all.
 */
export function isCashTender(t: { label?: string; labelKey?: string } | undefined): boolean {
    if (!t) return false;
    if (t.labelKey) return t.labelKey === 'com.clover.tender.cash';
    const label = t.label ?? '';
    return /cash|efectivo/i.test(label) && !/discount|descuento/i.test(label);
}

export const CAJA_LABELS = { BLANCA: 'Caja Blanca', NEGRA: 'Caja Negra' } as const;
export const TIPO_LABELS = { APERTURA: 'Apertura', RELEVO: 'Relevo', CIERRE: 'Cierre' } as const;
