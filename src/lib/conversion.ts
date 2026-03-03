export const ALLOWED_METRICS = ['Kg', 'g', 'Lbs', 'Solid Oz', 'Fl Oz', 'ml', 'L', 'Units'];

export const getConversionFactor = (parentUnit: string, childUnit: string): number | null => {
    if (!parentUnit || !childUnit) return null;
    const p = parentUnit.toLowerCase().trim();
    const c = childUnit.toLowerCase().trim();

    if (p === 'units' || c === 'units' || p === 'unidades' || c === 'unidades') {
        return p === c || (['units', 'unidades'].includes(p) && ['units', 'unidades'].includes(c)) ? 1 : null;
    }

    const MASS: Record<string, number> = {
        'g': 1, 'gramos': 1, 'grams': 1, 'gr': 1,
        'kg': 1000, 'kilogramos (kg)': 1000, 'kilogramos': 1000, 'kilos': 1000,
        'lbs': 453.592, 'lb': 453.592, 'libras': 453.592, 'libra': 453.592,
        'solid oz': 28.3495, 'oz': 28.3495, 'onzas': 28.3495,
    };

    const VOL: Record<string, number> = {
        'ml': 1, 'mililitros': 1, 'milliliters': 1,
        'l': 1000, 'liters': 1000, 'litros': 1000, 'litro': 1000, 'litros (l)': 1000,
        'fl oz': 29.5735, 'fluid oz': 29.5735, 'onzas liquidas': 29.5735, 'oz fluidas': 29.5735,
    };

    if (MASS[p] && MASS[c]) return MASS[p] / MASS[c];
    if (VOL[p] && VOL[c]) return VOL[p] / VOL[c];

    // Cross-category conversion assuming 1g = 1ml (approx density of water)
    if (MASS[p] && VOL[c]) return MASS[p] / VOL[c];
    if (VOL[p] && MASS[c]) return VOL[p] / MASS[c];

    return null;
};
