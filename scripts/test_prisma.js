const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function test() {
    const id = "cm7vk01e3000dpv1192g320ar"; // We don't have the real ID, but we can query it!
    const ingredient = await prisma.ingredient.findFirst({
        where: { name: { contains: "Chicharron" } },
        include: { inventory: true }
    });
    console.log("INGREDIENT:", ingredient?.name, "INVENTORY:", ingredient?.inventory);

    if (ingredient) {
        // Let's perform the exact upsert editIngredient does
        let data = {
            initialQty: 0,
            unfrozenQuantity: 21
        };

        const initialQty = typeof data.initialQty === 'number' ? data.initialQty : parseFloat(data.initialQty);
        const unfrozenQty = data.unfrozenQuantity !== undefined ? parseFloat(data.unfrozenQuantity) : initialQty;
        const frozenQty = Math.max(0, initialQty - unfrozenQty);
        console.log(`WILL UPSERT: thawingQty: ${unfrozenQty}, frozenQty: ${frozenQty}`);

        const result = await prisma.inventory.upsert({
            where: { ingredientId: ingredient.id },
            create: { ingredientId: ingredient.id, thawingQty: unfrozenQty, frozenQty: frozenQty },
            update: { thawingQty: unfrozenQty, frozenQty: frozenQty }
        });
        console.log("UPSERT RESULT:", result);
    }
}
test().catch(console.error).finally(() => prisma.$disconnect());
