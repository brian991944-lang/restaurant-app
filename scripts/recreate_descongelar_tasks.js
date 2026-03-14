const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const RENAME_MAP = {
    'Calamar Descongelado Porcion': 'Descongelar Calamar Porcion',
    'Camaron Descongelado Porcion': 'Descongelar Camaron Porcion',
    'Camaron Hervido': 'Descongelar Camaron Hervido',
    'Pescado Jalea Descongelado': 'Descongelar Pescado Jalea',
    'Pescado Ceviche': 'Descongelar Pescado Ceviche',
    'Pescado Macho Descongelado': 'Descongelar Pescado Macho',
    'Patas de Pulpo Anticuchadas': 'Descongelar Patas de Pulpo Anticuchadas',
    'Salmon Filete Descongelado': 'Descongelar Salmon Filete',
    'Seafood Mix Porcion Descongelada': 'Descongelar Seafood Mix Porcion',
    'Pollo Para Causa Descongelado': 'Descongelar Pollo Para Causa',
    'Pollo Para Chaufa Descongelado': 'Descongelar Pollo Para Chaufa',
    'Croquetas Descongeladas': 'Descongelar Croquetas',
    'Chicharron Porciones Descongeladas': 'Descongelar Chicharron Porciones',
    'Churrasco': 'Descongelar Churrasco',
    'Carne Lomo Chaufa': 'Descongelar Carne Lomo Chaufa',
    'Carne Lomo': 'Descongelar Carne Lomo'
};

async function main() {
    try {
        const category = await prisma.category.findFirst({
            where: { name: 'Descongelar' }
        });

        if (!category) {
            console.error("Descongelar category missing!");
            return;
        }

        console.log("Updating Tasks...");
        for (const [oldName, newName] of Object.entries(RENAME_MAP)) {
            let newlyNamedTask = await prisma.ingredient.findFirst({
                where: { name: newName }
            });
            if (newlyNamedTask) {
                console.log(`Task '${newName}' exists. Forcing type to TASK and category to Descongelar.`);
                await prisma.ingredient.update({
                    where: { id: newlyNamedTask.id },
                    data: {
                        categoryId: category.id,
                        type: 'TASK' // force it out of RAW or PREP
                    }
                });
            } else {
                console.log(`Creating missing Task '${newName}'.`);
                await prisma.ingredient.create({
                    data: {
                        name: newName,
                        categoryId: category.id,
                        type: 'TASK',
                        metric: 'units', // default
                        currentPrice: 0,
                        yieldPercent: 100,
                        subtractFromInventory: false
                    }
                });
            }
        }

        console.log("Done recreating database tasks.");
    } catch (e) {
        console.error("Error migrating tasks:", e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
