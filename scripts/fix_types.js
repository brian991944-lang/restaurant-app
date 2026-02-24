const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const ingredients = await prisma.ingredient.findMany({});
    const types = new Set(ingredients.map(i => i.type));
    console.log("Current ingredient types:", [...types]);

    // Fix incorrect custom types
    await prisma.ingredient.updateMany({
        where: { type: 'Raw Ingredients' },
        data: { type: 'RAW' }
    });
    await prisma.ingredient.updateMany({
        where: { type: 'Processed Ingredients' },
        data: { type: 'PROCESSED' }
    });
    await prisma.ingredient.updateMany({
        where: { type: 'Processed Food' },
        data: { type: 'PROCESSED' }
    });

    // Remake type options
    await prisma.dropdownOption.deleteMany({
        where: { group: 'Type' }
    });

    await prisma.dropdownOption.createMany({
        data: [
            { group: 'Type', name: 'RAW', isTranslated: true },
            { group: 'Type', name: 'PROCESSED', isTranslated: true },
            { group: 'Type', name: 'PREP_RECIPE', isTranslated: true }
        ]
    });

    console.log("Types mapped to RAW, PROCESSED, PREP_RECIPE!");
}

main().catch(console.error).finally(() => prisma.$disconnect());
