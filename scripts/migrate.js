const sqlite3 = require('sqlite3').verbose();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
    console.log("Starting Migration from dev.db to PostgreSQL...");

    const db = new sqlite3.Database('./prisma/dev.db', sqlite3.OPEN_READONLY, (err) => {
        if (err) {
            console.error('Error connecting to dev.db:', err.message);
            process.exit(1);
        }
    });

    // Helper to query sqlite
    const all = (query) => new Promise((resolve, reject) => {
        db.all(query, [], (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });

    try {
        console.log("Fetching Providers...");
        try {
            const providers = await all("SELECT * FROM Provider");
            for (const prov of providers) {
                await prisma.provider.upsert({
                    where: { id: prov.id },
                    update: prov,
                    create: prov,
                });
            }
            console.log(`Migrated ${providers.length} Providers.`);
        } catch (e) {
            console.log("No Provider table or records.");
        }

        console.log("Fetching Categories...");
        const categories = await all("SELECT * FROM Category");
        for (const cat of categories) {
            await prisma.category.upsert({
                where: { id: cat.id },
                update: cat,
                create: cat,
            });
        }
        console.log(`Migrated ${categories.length} Categories.`);

        console.log("Fetching Ingredients...");
        const ingredients = await all("SELECT * FROM Ingredient");
        for (const ing of ingredients) {
            // Remove foreign keys if they are null to prevent typing issues on Prisma
            if (ing.parentId === null || !ing.parentId) delete ing.parentId;
            if (ing.providerId === null || !ing.providerId) delete ing.providerId;
            if (ing.activeMarketItemId === null || !ing.activeMarketItemId) delete ing.activeMarketItemId;
            // Convert strings/dates safely
            if (ing.updatedAt) ing.updatedAt = new Date(ing.updatedAt);

            await prisma.ingredient.upsert({
                where: { id: ing.id },
                update: ing,
                create: ing,
            });
        }
        console.log(`Migrated ${ingredients.length} Ingredients.`);

        console.log("Fetching Inventories...");
        const inventories = await all("SELECT * FROM Inventory");
        for (const inv of inventories) {
            await prisma.inventory.upsert({
                where: { id: inv.id },
                update: inv,
                create: inv,
            });
        }
        console.log(`Migrated ${inventories.length} Inventory records.`);

    } catch (err) {
        console.error("Migration Error: ", err);
    } finally {
        db.close();
        await prisma.$disconnect();
    }
}

main();
