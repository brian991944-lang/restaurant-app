const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    const items = await prisma.ingredient.findMany({
        where: { name: { contains: 'Mariscos' } },
        include: { inventory: true, parent: { include: { inventory: true } }, category: true }
    });
    console.log(JSON.stringify(items, null, 2));
}
main();
