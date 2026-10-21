// Yield math for the Hoja de limpieza. Plain module (not 'use server') so the
// sheet can recompute on every keystroke and the server action saves the exact
// same numbers it showed the cook.

export const G_PER_LB = 453.592;
const MISSING_FLOOR_LB = 1;   // "faltante" only when more than 1 lb (or 5% of raw) is unexplained
const BAND_TOLERANCE = 3;     // percentage points outside the expected band before LOW / HIGH

export type CleaningFlag = 'OK' | 'LOW' | 'HIGH' | 'MISSING';

export interface CleaningMath {
    producedWeightLb: number;
    yieldPct: number;
    unaccountedLb: number;
    /** With each product's accepted range (portionMinG–portionMaxG): portions at their lightest / heaviest. */
    producedMinLb: number;
    producedMaxLb: number;
    yieldMinPct: number;
    yieldMaxPct: number;
    /** Best case (heaviest portions) and worst case (lightest). */
    unaccountedMinLb: number;
    unaccountedMaxLb: number;
    /** The tolerance used for MISSING / HIGH, in lb. */
    toleranceLb: number;
    flag: CleaningFlag;
}

/** Expected yield band = the products' own yieldPercent. Products left at 100 (unset) fall back to a wide band. */
export function bandFor(yields: number[]): { min: number; max: number } {
    const real = yields.filter(y => y > 0 && y < 100);
    if (real.length === 0) return { min: 60, max: 100 };
    return { min: Math.min(...real), max: Math.max(...real) };
}

export function computeCleaning(input: {
    rawWeightLb: number; wasteWeightLb: number;
    outputs: { qty: number; portionWeightG: number; yieldPercent: number; portionMinG?: number | null; portionMaxG?: number | null }[];
    band?: { min: number; max: number } | null;
}): CleaningMath {
    const sum = (w: (o: (typeof input.outputs)[number]) => number) =>
        input.outputs.reduce((s, o) => s + (o.qty > 0 ? (o.qty * w(o)) / G_PER_LB : 0), 0);
    const producedWeightLb = sum(o => o.portionWeightG);
    const producedMinLb = sum(o => o.portionMinG ?? o.portionWeightG);
    const producedMaxLb = sum(o => o.portionMaxG ?? o.portionWeightG);
    const raw = input.rawWeightLb;
    const pct = (lb: number) => (raw > 0 ? (lb / raw) * 100 : 0);
    const yieldPct = pct(producedWeightLb);
    const unaccountedLb = raw - input.wasteWeightLb - producedWeightLb;
    const unaccountedMinLb = raw - input.wasteWeightLb - producedMaxLb;
    const unaccountedMaxLb = raw - input.wasteWeightLb - producedMinLb;
    const band = input.band ?? bandFor(input.outputs.filter(o => o.qty > 0).map(o => o.yieldPercent));
    const toleranceLb = Math.max(MISSING_FLOOR_LB, raw * 0.05);
    // Portions are cut within a range, so a flag needs the whole range to be out:
    // missing only if meat is unexplained even with every portion at its heaviest, etc.
    let flag: CleaningFlag = 'OK';
    if (unaccountedMinLb > toleranceLb) flag = 'MISSING';
    else if (unaccountedMaxLb < -toleranceLb || pct(producedMinLb) > band.max + BAND_TOLERANCE) flag = 'HIGH';
    else if (pct(producedMaxLb) < band.min - BAND_TOLERANCE) flag = 'LOW';
    return {
        producedWeightLb, yieldPct, unaccountedLb, toleranceLb, flag,
        producedMinLb, producedMaxLb, yieldMinPct: pct(producedMinLb), yieldMaxPct: pct(producedMaxLb), unaccountedMinLb, unaccountedMaxLb,
    };
}
