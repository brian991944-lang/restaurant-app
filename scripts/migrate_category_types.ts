import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log("Starting category migration...");

    const categories = await prisma.category.findMany({
        include: { _count: { select: { ingredients: true } } }
    });

    console.log(`Found ${categories.length} categories.`);

    for (const cat of categories) {
        let type = 'INGREDIENT';
        const nameUpper = cat.name.toUpperCase();

        // Logic to determine if a category is a TASK category
        if (
            nameUpper.includes('BASES') ||
            nameUpper.includes('MATUTINO') ||
            nameUpper.includes('PREP') ||
            nameUpper.includes('TAREA') ||
            nameUpper.includes('WORKFLOW') ||
            nameUpper.includes('TURNOS')
        ) {
            type = 'TASK';
        }

        // Double check: if it has ingredients, and its type is still 'RAW' or 'PROCESSED' - wait, we check the type of linked ingredients.
        const linkedIngredients = await prisma.ingredient.findMany({
            where: { categoryId: cat.id },
            select: { type: true }
        });

        // If it only contains PREP items, it's a TASK
        const allPrep = linkedIngredients.length > 0 && linkedIngredients.every(i => i.type === 'PREP');
        if (allPrep) {
            type = 'TASK';
        }

        await prisma.category.update({
            where: { id: cat.id },
            data: { type }
        });
        console.log(`Updated category: ${cat.name} -> ${type}`);
    }

    console.log("Migration complete!");
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
