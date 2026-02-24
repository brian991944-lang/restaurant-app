const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function translateToSpanish(text) {
    if (!text) return text;
    try {
        const response = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=es&dt=t&q=${encodeURIComponent(text)}`);
        const data = await response.json();
        return data[0][0][0] || text;
    } catch (e) {
        console.error("Translation fail:", e);
        return `${text} (ES)`;
    }
}

async function main() {
    console.log("Starting batch translation script...");

    const categories = await prisma.category.findMany({ where: { nameEs: null } });
    console.log(`Found ${categories.length} categories to translate.`);
    for (const cat of categories) {
        const nameEs = await translateToSpanish(cat.name);
        await prisma.category.update({
            where: { id: cat.id },
            data: { nameEs }
        });
        console.log(`Translated category ${cat.name} -> ${nameEs}`);
    }

    const ingredients = await prisma.ingredient.findMany({ where: { nameEs: null } });
    console.log(`Found ${ingredients.length} ingredients to translate.`);
    for (const ing of ingredients) {
        const nameEs = await translateToSpanish(ing.name);
        await prisma.ingredient.update({
            where: { id: ing.id },
            data: { nameEs }
        });
        console.log(`Translated ingredient ${ing.name} -> ${nameEs}`);
    }

    console.log("Translation complete!");
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
