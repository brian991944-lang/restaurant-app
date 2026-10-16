import { getConversionFactor } from '@/lib/conversion';

// Unit handling for "Recibir compra". Stock always stays in the ingredient's
// own metric; these helpers turn what was bought into that metric, and give
// the one short display label for a unit string. Plain module (not
// 'use server') so the Compras UI, the server action and the API share it.

/** Display label for a metric/pack unit. Display only — never stored. */
export function unitLabel(unit: string | null | undefined, locale: 'es' | 'en' = 'es'): string {
    const u = (unit ?? '').toLowerCase().trim();
    if (['lbs', 'lb', 'pound', 'pounds'].includes(u)) return 'lb';
    if (['l', 'liter', 'liters', 'litro', 'litros'].includes(u)) return 'L';
    if (u === 'kg') return 'kg';
    if (u === 'g') return 'g';
    if (u === 'solid oz' || u === 'oz') return 'oz';
    if (['units', 'unit', 'unid.', 'unidades'].includes(u)) return locale === 'es' ? 'unid.' : 'units';
    return unit ?? '';
}

// How many of the ingredient's metric one pound is. Only weight metrics.
const METRIC_PER_LB: Record<string, number> = {
    lbs: 1, lb: 1, pound: 1, pounds: 1,
    kg: 0.4536,
    g: 453.6,
    'solid oz': 16, oz: 16,
};

/** True when the metric is a weight, i.e. a "Peso total (lb)" makes sense. */
export function isWeightMetric(metric: string | null | undefined): boolean {
    return METRIC_PER_LB[(metric ?? '').toLowerCase().trim()] !== undefined;
}

function fmt(n: number): string {
    return Number(n.toFixed(2)).toString();
}

export interface CreditIngredient {
    name: string;
    metric: string;
    isPacked: boolean;
    unitsPerPack: number;
    packUnit: string;
}

/** Readable pack size, e.g. "50 lb" or "425 g"; null for loose items. */
export function packSize(ing: Pick<CreditIngredient, 'isPacked' | 'unitsPerPack' | 'packUnit'>): string | null {
    return ing.isPacked ? `${fmt(ing.unitsPerPack)} ${unitLabel(ing.packUnit)}` : null;
}

/**
 * The amount to credit to stock, in the ingredient's metric.
 *   a) totalWeightLb given and the metric is a weight → that weight in metric
 *   b) packed → qty is always packs: qty × unitsPerPack, packUnit → metric
 *   c) loose → qty as sent, when the sent unit is the metric (or converts to it)
 * Returns a Spanish error when there is no conversion path.
 */
export function computeCredit(
    ing: CreditIngredient,
    line: { qty: number; unit?: string | null; totalWeightLb?: number | null },
): { ok: true; credited: number } | { ok: false; error: string } {
    const metricKey = ing.metric.toLowerCase().trim();

    if (line.totalWeightLb != null && line.totalWeightLb > 0 && METRIC_PER_LB[metricKey] !== undefined) {
        return { ok: true, credited: line.totalWeightLb * METRIC_PER_LB[metricKey] };
    }

    if (ing.isPacked) {
        const perPack = ing.unitsPerPack > 0 ? ing.unitsPerPack : 1;
        const factor = unitLabel(ing.packUnit) === unitLabel(ing.metric) ? 1 : getConversionFactor(ing.packUnit, ing.metric);
        if (factor == null) {
            return { ok: false, error: `${ing.name}: no se puede convertir ${ing.packUnit} a ${ing.metric}.` };
        }
        return { ok: true, credited: line.qty * perPack * factor };
    }

    const sent = (line.unit ?? '').trim();
    if (!sent || unitLabel(sent) === unitLabel(ing.metric)) return { ok: true, credited: line.qty };
    const factor = getConversionFactor(sent, ing.metric);
    if (factor == null) {
        return {
            ok: false,
            error: isWeightMetric(ing.metric)
                ? `${ing.name}: falta el peso total (lb) para ${line.qty} ${sent}.`
                : `${ing.name}: no se puede convertir ${sent} a ${ing.metric}.`,
        };
    }
    return { ok: true, credited: line.qty * factor };
}
