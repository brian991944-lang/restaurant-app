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
    outputs: { qty: number; portionWeightG: number; yieldPercent: number }[];
    band?: { min: number; max: number } | null;
}): CleaningMath {
    const producedWeightLb = input.outputs.reduce((s, o) => s + (o.qty > 0 ? (o.qty * o.portionWeightG) / G_PER_LB : 0), 0);
    const yieldPct = input.rawWeightLb > 0 ? (producedWeightLb / input.rawWeightLb) * 100 : 0;
    const unaccountedLb = input.rawWeightLb - input.wasteWeightLb - producedWeightLb;
    const band = input.band ?? bandFor(input.outputs.filter(o => o.qty > 0).map(o => o.yieldPercent));
    const toleranceLb = Math.max(MISSING_FLOOR_LB, input.rawWeightLb * 0.05);
    let flag: CleaningFlag = 'OK';
    if (unaccountedLb > toleranceLb) flag = 'MISSING';
    else if (unaccountedLb < -toleranceLb || yieldPct > band.max + BAND_TOLERANCE) flag = 'HIGH';
    else if (yieldPct < band.min - BAND_TOLERANCE) flag = 'LOW';
    return { producedWeightLb, yieldPct, unaccountedLb, toleranceLb, flag };
}
