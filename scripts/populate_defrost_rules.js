const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const RECOMMENDATIONS = {
    'Descongelar Calamar Porcion': { 0: 40, 1: 40, 2: 40, 3: 40, 4: 100, 5: 100, 6: 100 },
    'Descongelar Camaron Porcion': { 0: 40, 1: 40, 2: 35, 3: 40, 4: 60, 5: 60, 6: 60 },
    'Descongelar Camaron Hervido': { 0: 5, 1: 5, 2: 5, 3: 5, 4: 15, 5: 15, 6: 15 },
    'Descongelar Pescado Jalea': { 0: 5, 1: 5, 2: 5, 3: 5, 4: 10, 5: 10, 6: 10 },
    'Descongelar Pescado Ceviche': { 0: 30, 1: 30, 2: 30, 3: 30, 4: 60, 5: 5, 6: 60 },
    'Descongelar Pescado Macho': { 0: 5, 1: 5, 2: 5, 3: 5, 4: 60, 5: 60, 6: 60 },
    'Descongelar Patas de Pulpo Anticuchadas': { 0: 7, 1: 7, 2: 7, 3: 7, 4: 15, 5: 15, 6: 15 },
    'Descongelar Salmon Filete': { 0: 7, 1: 7, 2: 7, 3: 7, 4: 15, 5: 5, 6: 15 },
    'Descongelar Seafood Mix Porcion': { 0: 7, 1: 7, 2: 7, 3: 7, 4: 15, 5: 10, 6: 15 },
    'Descongelar Pollo Para Causa': { 0: 5, 1: 5, 2: 5, 3: 5, 4: 10, 5: 10, 6: 10 },
    'Descongelar Pollo Para Chaufa': { 0: 25, 1: 25, 2: 20, 3: 25, 4: 50, 5: 50, 6: 50 },
    'Descongelar Croquetas': { 0: 15, 1: 10, 2: 10, 3: 10, 4: 30, 5: 30, 6: 30 },
    'Descongelar Chicharron Porciones': { 0: 7, 1: 7, 2: 7, 3: 7, 4: 12, 5: 12, 6: 12 },
    'Bisteck - Porcionar': { 0: 10, 1: 10, 2: 10, 3: 10, 4: 20, 5: 25, 6: 25 },
    'Lomo Chaufa - Cortar y Porcionar': { 0: 10, 1: 10, 2: 10, 3: 10, 4: 10, 5: 10, 6: 10 },
    'Lomo - Cortar y Porcionar': { 0: 20, 1: 20, 2: 20, 3: 20, 4: 35, 5: 45, 6: 35 },
};

async function main() {
    try {
        console.log("Starting population of RecurringPrepRules...");

        for (const [taskName, days] of Object.entries(RECOMMENDATIONS)) {
            // Find the ingredientId for this task
            const ingredient = await prisma.ingredient.findFirst({
                where: { name: taskName }
            });

            if (!ingredient) {
                console.log(`[WARNING] Task not found in DB: '${taskName}'. Skipping...`);
                continue;
            }

            const ingredientId = ingredient.id;

            // Delete existing rules for this ingredient to avoid duplicates
            await prisma.recurringPrepRule.deleteMany({
                where: { ingredientId }
            });
            console.log(`Cleared old rules for '${taskName}'.`);

            // Insert the new rules
            const inserts = Object.entries(days).map(([dayStr, amount]) => {
                return {
                    ingredientId,
                    dayOfWeek: parseInt(dayStr),
                    amount
                }
            });

            await prisma.recurringPrepRule.createMany({
                data: inserts
            });

            console.log(`Inserted ${inserts.length} rules for '${taskName}'.`);
        }

        console.log("Migration complete.");
    } catch (e) {
        console.error("Migration failed:", e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
