const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const recipe = await prisma.digitalRecipe.findUnique({
        where: { recipeCode: 'SAL-005' }
    });

    let ingredients = JSON.parse(recipe.ingredientsJson || '[]');
    let modified = false;

    for (let i = 0; i < ingredients.length; i++) {
        if (ingredients[i].ingredient.includes('Coca Cola')) {
            ingredients[i].quantity = '180';
            ingredients[i].metric = 'g';
            modified = true;
        }
    }

    if (modified) {
        await prisma.digitalRecipe.update({
            where: { recipeCode: 'SAL-005' },
            data: { ingredientsJson: JSON.stringify(ingredients) }
        });
        console.log('Updated Coca Cola to 180g in ingredientsJson.');
    } else {
        console.log('No modifications needed.');
    }
}

main()
    .catch(e => {
        console.error(e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
