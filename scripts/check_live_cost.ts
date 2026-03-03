import { PrismaClient } from '@prisma/client';
import { getConversionFactor } from '../src/lib/conversion';

const prisma = new PrismaClient();

const resolveCost = (item: any, allIngredients: any[]): number => {
    if (!item) return 0;
    if (item.type === 'RAW') return item.currentPrice || 0;
    if (item.type === 'PROCESSED') {
        if (item.metric?.toLowerCase() === 'units') return item.currentPrice || 0;
        const parentCost = item.parent ? resolveCost(allIngredients.find(dbI => dbI.id === item.parent?.id) || item.parent, allIngredients) : (item.currentPrice || 0);
        return parentCost / Math.max(0.01, (item.yieldPercent / 100));
    }
    if (item.type === 'PREP_RECIPE') {
        if (!item.composedOf || item.composedOf.length === 0) return item.currentPrice || 0;
        const sum = item.composedOf.reduce((acc: number, comp: any) => {
            const dep = allIngredients.find(dbI => dbI.id === comp.ingredientId) || comp.ingredient;
            let costToAdd = 0;
            if (dep) {
                const baseUnit = dep.metric || 'Units';
                if (baseUnit.toLowerCase() === 'units' || (comp.unit || '').toLowerCase() === 'units') {
                    costToAdd = resolveCost(dep, allIngredients) * (parseFloat(comp.quantity) || 0);
                } else {
                    const cFactor = getConversionFactor(baseUnit, comp.unit || 'Units');
                    if (cFactor) {
                        costToAdd = (resolveCost(dep, allIngredients) / cFactor) * (parseFloat(comp.quantity) || 0);
                    }
                }
            }
            console.log(`[PREP RECIPE DEBUG: ${item.name}] Dep: ${dep?.name}. BaseUnit: ${dep?.metric}. CompUnit: ${comp.unit}. Qty: ${comp.quantity}. CostToAdd: ${costToAdd}`);
            return acc + costToAdd;
        }, 0);
        const batchSize = item.portionWeightG || 1;
        const costPerUnit = sum / Math.max(0.01, batchSize);
        console.log(`[PREP RECIPE DEBUG: ${item.name}] SUM = ${sum}. BATCH SIZE = ${batchSize}. COST PER UNIT = ${costPerUnit}`);
        return costPerUnit / Math.max(0.01, (item.yieldPercent / 100));
    }
    return item.currentPrice || 0;
};

async function check() {
    const dbIngredients = await prisma.ingredient.findMany({
        include: {
            parent: true,
            composedOf: { include: { ingredient: true } }
        }
    });

    const menuItems = await prisma.menuItem.findMany({
        include: {
            modifiers: { include: { ingredients: true } },
            recipeIngredients: {
                include: {
                    ingredient: {
                        include: {
                            parent: true,
                            composedOf: { include: { ingredient: true } }
                        }
                    }
                }
            }
        }
    });

    const targetItem = menuItems.find(mi => mi.name === "Huancaina Sauce (2oz)");
    if (!targetItem) return console.log("Target not found");

    console.log(`Inspecting ${targetItem.name}`);
    let totalCost = 0;
    targetItem.recipeIngredients.forEach((req: any) => {
        const ing = req.ingredient;
        const baseUnit = ing ? (ing.metric || 'Units') : 'Units';
        const reqUnit = req.unit || 'Units';

        let lineCost = 0;
        if (baseUnit.toLowerCase() === 'units' || reqUnit.toLowerCase() === 'units') {
            lineCost = resolveCost(ing, dbIngredients) * req.quantity;
        } else {
            const cFactor = getConversionFactor(baseUnit, reqUnit);
            if (cFactor) {
                const rCost = resolveCost(ing, dbIngredients);
                console.log(`   -> RECIPE INGREDIENT: ${ing?.name} (${baseUnit} -> ${reqUnit} with factor ${cFactor}). Unit cost: ${rCost}`);
                lineCost = (rCost / cFactor) * req.quantity;
            }
        }
        totalCost += lineCost;
    });

    console.log(`Final cost: ${totalCost}`);
}

check().catch(console.error).finally(() => prisma.$disconnect());
