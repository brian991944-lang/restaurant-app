const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const item = await prisma.ingredient.findFirst({
        where: { name: 'Chicha Morada Cheesecake', type: 'PREP_RECIPE' },
        include: {
            composedOf: true
        }
    });

    if (item) {
        console.log(`Item found: ${item.name}`);
        console.log(`Components:`);
        item.composedOf.forEach(c => {
            console.log(`- ${c.groupName || '<NULL>'} : ${c.ingredientId} (Qty: ${c.quantity})`);
        });
    } else {
        console.log("Not found.");
    }
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
