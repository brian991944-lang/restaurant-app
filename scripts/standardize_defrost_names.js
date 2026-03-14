const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const MAPPINGS = {
    // Current DB Name -> New Standardized Name
    'Calamar Descongelado Porcion': 'Descongelar Calamar Porcion',
    'Camaron Descongelado Porcion': 'Descongelar Camaron Porcion',
    'Pescado Jalea Descongelado': 'Descongelar Pescado Jalea',
    'Pescado Macho Descongelado': 'Descongelar Pescado Macho',
    'Salmon Filete Descongelado': 'Descongelar Salmon Filete',
    'Seafood Mix Porcion Descongelada': 'Descongelar Seafood Mix Porcion',
    'Pollo Para Causa Descongelado': 'Descongelar Pollo Para Causa',
    'Pollo Para Chaufa Descongelado': 'Descongelar Pollo Para Chaufa',
    'Croquetas Descongeladas': 'Descongelar Croquetas',
    'Chicharron Porciones Descongeladas': 'Descongelar Chicharron Porciones'
};

async function main() {
    console.log("Starting DB Name Standardization...");
    for (const [oldName, newName] of Object.entries(MAPPINGS)) {
        try {
            const ing = await prisma.ingredient.findFirst({ where: { name: oldName } });
            if (ing) {
                await prisma.ingredient.update({
                    where: { id: ing.id },
                    data: { name: newName }
                });
                console.log(`Updated: '${oldName}' -> '${newName}'`);

                // Also update recurring rules to make sure we don't break them
                const rulesCount = await prisma.recurringPrepRule.count({
                    where: { ingredientId: ing.id }
                });
                console.log(`- Verified ${rulesCount} existing recurring rules for ${newName}`);
            } else {
                console.log(`Skipped: '${oldName}' not found in DB.`);
            }
        } catch (e) {
            console.error(`Error updating '${oldName}':`, e.message);
        }
    }
    console.log("Standardization complete.");
}

main().finally(() => prisma.$disconnect());
