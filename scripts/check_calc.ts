import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
import { getConversionFactor } from '../src/lib/conversion';

async function check() {
    const allIngredients = await prisma.ingredient.findMany({
        include: { parent: true, composedOf: { include: { ingredient: true } } }
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

    const resolveCost = (item: any): number => {
        if (!item) return 0;
        if (item.type === 'RAW') return item.currentPrice || 0;
        if (item.type === 'PROCESSED') {
            if (item.metric?.toLowerCase() === 'units') return item.currentPrice || 0;
            const parentCost = item.parent ? resolveCost(allIngredients.find(dbI => dbI.id === item.parent?.id) || item.parent) : (item.currentPrice || 0);
            return parentCost / Math.max(0.01, ((item.yieldPercent || 100) / 100));
        }
        if (item.type === 'PREP_RECIPE') {
            return (item.currentPrice || 0) / Math.max(0.01, ((item.yieldPercent || 100) / 100));
        }
        return item.currentPrice || 0;
    };

    const targetItem = menuItems.find(mi => mi.name === "Huancaina Sauce (2oz)");
    let totalCost = 0;
    targetItem?.recipeIngredients?.forEach((req: any) => {
        const ing = req.ingredient;
        const baseUnit = ing ? (ing.metric || 'Units') : 'Units';
        const reqUnit = req.unit || 'Units';

        let lineCost = 0;
        if (baseUnit.toLowerCase() === 'units' || reqUnit.toLowerCase() === 'units') {
            lineCost = resolveCost(ing) * req.quantity;
        } else {
            const cFactor = getConversionFactor(baseUnit, reqUnit);
            if (cFactor) {
                lineCost = (resolveCost(ing) / cFactor) * req.quantity;
            }
        }
        totalCost += lineCost;
        console.log(`[Item: ${ing.name}] baseUnit=${baseUnit}, reqUnit=${reqUnit}, qty=${req.quantity}, currentPrice=${ing.currentPrice}, lineCost=${lineCost}`);
    });
    console.log(`Total live cost Menu page calculation: ${totalCost}`);
}

check().finally(() => prisma.$disconnect());
