const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const menuItems = [
    { name: 'Classic Ceviche', salePrice: 25.0, category: 'Ceviches' },
    { name: 'Ceviche Mixto', salePrice: 30.0, category: 'Ceviches' },
    { name: 'Charapa Ceviche', salePrice: 23.0, category: 'Ceviches' },
    { name: 'Aji de Gallina Croquette', salePrice: 15.0, category: 'Appetizers' },
    { name: 'Anticuchos de Camaron', salePrice: 18.0, category: 'Appetizers' },
    { name: 'Choritos a la Chalaca', salePrice: 16.0, category: 'Appetizers' },
    { name: 'Lomo Saltado', salePrice: 27.0, category: 'Entrees' },
    { name: 'Pescado a lo Macho', salePrice: 28.0, category: 'Entrees' },
    { name: 'Arroz con Mariscos', salePrice: 30.0, category: 'Entrees' },
    { name: 'Huancaina Sauce (2oz)', salePrice: 2.0, category: 'Sauces' },
    { name: 'Uchucuta Sauce (2oz)', salePrice: 2.0, category: 'Sauces' },
    { name: 'Rocoto Sauce (2oz)', salePrice: 2.0, category: 'Sauces' }
];

async function main() {
    console.log("Setting up initial menu items...");

    let addedCount = 0;
    for (const item of menuItems) {
        // Upsert based on name
        const existing = await prisma.menuItem.findUnique({
            where: { name: item.name }
        });

        if (!existing) {
            await prisma.menuItem.create({
                data: {
                    name: item.name,
                    salePrice: item.salePrice,
                    category: item.category,
                    targetFoodCostPct: 25.0
                }
            });
            addedCount++;
        } else {
            // Update if exists but without category
            await prisma.menuItem.update({
                where: { id: existing.id },
                data: { category: item.category, salePrice: item.salePrice }
            });
        }
    }

    console.log(`Setup complete! Ensured ${menuItems.length} menu items are present. (Added ${addedCount} new)`);
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
