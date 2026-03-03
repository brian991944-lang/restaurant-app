import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ALLOWED_METRICS = ['Kg', 'g', 'Lbs', 'Solid Oz', 'Fl Oz', 'ml', 'L', 'Units'];

const mapMetric = (metricName: string): string => {
    if (!metricName) return 'Units';
    const m = metricName.toLowerCase().trim();

    const MASS: Record<string, string> = {
        'g': 'g', 'gramos': 'g', 'grams': 'g', 'gr': 'g',
        'kg': 'Kg', 'kilogramos (kg)': 'Kg', 'kilogramos': 'Kg', 'kilos': 'Kg',
        'lbs': 'Lbs', 'lb': 'Lbs', 'libras': 'Lbs', 'libra': 'Lbs',
        'solid oz': 'Solid Oz', 'oz': 'Solid Oz', 'onzas': 'Solid Oz',
    };

    const VOL: Record<string, string> = {
        'ml': 'ml', 'mililitros': 'ml', 'milliliters': 'ml',
        'l': 'L', 'liters': 'L', 'litros': 'L', 'litro': 'L', 'litros (l)': 'L',
        'fl oz': 'Fl Oz', 'fluid oz': 'Fl Oz', 'onzas liquidas': 'Fl Oz', 'oz fluidas': 'Fl Oz',
    };

    if (m === 'units' || m === 'unidades') return 'Units';

    if (MASS[m]) return MASS[m];
    if (VOL[m]) return VOL[m];

    return metricName; // Fallback if no matching standard unit
};

async function main() {
    console.log("Starting Metric Normalization Script...");

    const ingredients = await prisma.ingredient.findMany();
    let updatedCount = 0;

    for (const item of ingredients) {
        if (!item.metric) continue;
        const normalized = mapMetric(item.metric);

        if (normalized !== item.metric) {
            console.log(`Normalizing parent ingredient "${item.name}": "${item.metric}" -> "${normalized}"`);
            await prisma.ingredient.update({
                where: { id: item.id },
                data: { metric: normalized }
            });
            updatedCount++;
        }
    }

    const recipeItems = await prisma.recipeIngredient.findMany();
    for (const rw of recipeItems) {
        if (!rw.unit) continue;
        const normalized = mapMetric(rw.unit);

        if (normalized !== rw.unit) {
            console.log(`Normalizing RECIPE ITEM for ingredient "${rw.ingredientId}": "${rw.unit}" -> "${normalized}"`);
            await prisma.recipeIngredient.update({
                where: { id: rw.id },
                data: { unit: normalized }
            });
            updatedCount++;
        }
    }

    console.log(`Sanitization complete! Updated ${updatedCount} entries.`);
}

main()
    .catch(console.error)
    .finally(async () => {
        await prisma.$disconnect();
    });
