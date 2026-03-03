import { getConversionFactor } from './conversion';

export const resolveIngredientCost = (item: any, allIngredients: any[]): number => {
    if (!item) return 0;
    if (item.type === 'RAW') return parseFloat(item.currentPrice || 0);
    if (item.type === 'PROCESSED') {
        if (item.metric?.toLowerCase() === 'units') return parseFloat(item.currentPrice || 0);
        const parentCost = item.parent ? resolveIngredientCost(allIngredients.find(dbI => dbI.id === item.parent?.id) || item.parent, allIngredients) : parseFloat(item.currentPrice || 0);
        return parentCost / Math.max(0.01, ((parseFloat(item.yieldPercent) || 100) / 100));
    }
    if (item.type === 'PREP_RECIPE') {
        // We use the statically saved currentPrice of the PREP_RECIPE, reflecting the batch cost
        return parseFloat(item.currentPrice || 0) / Math.max(0.01, ((parseFloat(item.yieldPercent) || 100) / 100));
    }
    return parseFloat(item.currentPrice || 0);
};

export const calculateRecipeCost = (
    components: { ingredientId?: string, ingredient?: any, quantity: string | number, unit: string }[],
    allIngredients: any[]
): number => {
    let totalCost = 0;
    components.forEach((comp) => {
        const ing = comp.ingredient || allIngredients.find(dbI => dbI.id === comp.ingredientId);
        if (!ing) return;
        const baseUnit = ing.metric || 'Units';
        const reqUnit = comp.unit || 'Units';

        let lineCost = 0;
        if (baseUnit.toLowerCase() === 'units' || reqUnit.toLowerCase() === 'units') {
            lineCost = resolveIngredientCost(ing, allIngredients) * parseFloat(comp.quantity.toString() || '0');
        } else {
            const cFactor = getConversionFactor(baseUnit, reqUnit);
            if (cFactor) {
                lineCost = (resolveIngredientCost(ing, allIngredients) / cFactor) * parseFloat(comp.quantity.toString() || '0');
            }
        }
        totalCost += lineCost;
    });
    return totalCost;
};
