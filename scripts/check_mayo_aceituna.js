const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const recipes = await prisma.digitalRecipe.findMany({
        where: { name: { contains: 'Mayonesa de Aceituna' } }
    });
    console.log(recipes.map(r => ({ id: r.id, name: r.name, code: r.recipeCode })));
}

main().catch(console.error).finally(() => prisma.$disconnect());
