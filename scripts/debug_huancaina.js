const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const recipes = await prisma.digitalRecipe.findMany({
        where: {
            name: {
                contains: 'Huancaina'
            }
        }
    });
    console.log("Found recipes:");
    console.dir(recipes, { depth: null });
}

main()
    .catch(e => {
        console.error(e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
