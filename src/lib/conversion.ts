export const ALLOWED_METRICS = ['Kg', 'g', 'Lbs', 'Solid Oz', 'Fl Oz', 'ml', 'L', 'Units'];

export const getConversionFactor = (parentUnit: string, childUnit: string): number | null => {
    if (!parentUnit || !childUnit) return null;
    const p = parentUnit.toLowerCase().trim();
    const c = childUnit.toLowerCase().trim();

    if (p === 'units' || c === 'units') {
        return p === c ? 1 : null;
    }

    const MASS: Record<string, number> = {
        'g': 1,
        'kg': 1000,
        'lbs': 453.592, 'lb': 453.592,
        'solid oz': 28.3495, 'oz': 28.3495,
    };

    const VOL: Record<string, number> = {
        'ml': 1,
        'l': 1000,
        'fl oz': 29.5735,
    };

    if (MASS[p] && MASS[c]) return MASS[p] / MASS[c];
    if (VOL[p] && VOL[c]) return VOL[p] / VOL[c];

    // Cross-category conversion assuming 1g = 1ml (approx density of water)
    if (MASS[p] && VOL[c]) return MASS[p] / VOL[c];
    if (VOL[p] && MASS[c]) return VOL[p] / MASS[c];

    return null;
};
