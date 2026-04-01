const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const recipe = await prisma.digitalRecipe.findUnique({
        where: { recipeCode: 'SAL-005' }
    });

    console.log('--- Current Recipe SAL-005 Ingredients JSON ---');
    console.log(recipe.ingredientsJson);

    console.log('--- Current dbIngredients for Anticuchera ---');
    const parent = await prisma.ingredient.findFirst({
        where: { name: { contains: 'Anticuchera' } }
    });
    const composedOf = await prisma.prepRecipeIngredient.findMany({
        where: { prepRecipeId: parent.id },
        include: { ingredient: true }
    });
    composedOf.forEach(c => {
        console.log(`- ${c.ingredient.name}: ${c.quantity} ${c.unit || ''}`);
    });
}

main()
    .catch(e => {
        console.error(e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
