const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
    console.log("Starting menu updates...");

    // 1. Price Corrections for Existing Items (Appetizers)
    console.log("Updating prices...");
    await prisma.menuItem.updateMany({
        where: { name: "Aji de Gallina Croquette" },
        data: { salePrice: 16.00 }
    });

    await prisma.menuItem.updateMany({
        where: { name: "Anticuchos de Camaron" },
        data: { salePrice: 17.00 }
    });

    // Helper to upsert menu items
    async function upsertItem(name, category, salePrice) {
        await prisma.menuItem.upsert({
            where: { name },
            update: { category, salePrice },
            create: { name, category, salePrice }
        });
        console.log(`Upserted: ${name} ($${salePrice}) in ${category}`);
    }

    // 2. Add Missing Items to 'Appetizers'
    await upsertItem("Chicharron de Chancho", "Appetizers", 16.00);
    await upsertItem("Charcoal Grilled Pulpo", "Appetizers", 26.00);

    // 3. Create New Category 'Tapas' and Add
    await upsertItem("Duo Inca", "Tapas", 13.00);
    await upsertItem("Papa a la Huancaina", "Tapas", 13.00);
    await upsertItem("Yuca a la Huancaina", "Tapas", 12.00);
    await upsertItem("Fried Calamari", "Tapas", 13.00);
    await upsertItem("Causa de Pollo", "Tapas", 14.00);

    // 4. Add Missing Items to 'Entrees'
    await upsertItem("Lomo Saltado with Linguine a la Huancaina", "Entrees", 30.00);
    await upsertItem("Linguini al Pesto with Bistec", "Entrees", 33.00);
    await upsertItem("Salmon a la Maracuya", "Entrees", 32.00);
    await upsertItem("Build Your Own Gnocchi", "Entrees", 24.00);
    await upsertItem("Arroz Chaufa", "Entrees", 17.00);
    await upsertItem("Jalea", "Entrees", 26.00);

    // 5. Create New Category 'Sides' and Add
    await upsertItem("Yucca Frita", "Sides", 6.00);
    await upsertItem("White rice", "Sides", 4.00);
    await upsertItem("Yellow Potato Wedges and Choclo", "Sides", 6.00);
    await upsertItem("French Fries", "Sides", 5.00);
    await upsertItem("Sweet potato Chips", "Sides", 4.00);
    await upsertItem("Platanos Maduros", "Sides", 6.00);
    await upsertItem("Tostones", "Sides", 6.00);
    await upsertItem("House Salad", "Sides", 10.00);

    // 6. Add Missing Items to 'Sauces'
    await upsertItem("Huancaina Sauce (4oz)", "Sauces", 4.00);
    await upsertItem("Rocoto Sauce (4oz)", "Sauces", 4.00);
    await upsertItem("Uchucuta Sauce (4oz)", "Sauces", 4.00);

    // 7. Create New Category 'Kids Menu' and Add
    await upsertItem("Chicken Tenders & Fries", "Kids Menu", 13.00);
    await upsertItem("Fish Sticks & Fries", "Kids Menu", 13.00);

    // 8. Create New Category 'Prix Fixe' and Add
    await upsertItem("Ronda Fusionista", "Prix Fixe", 69.00);
    await upsertItem("Sabores del Mar", "Prix Fixe", 79.00);

    console.log("Menu updates completed successfully.");
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
