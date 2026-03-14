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
        console.log("Finding or creating Category 'Descongelar'...");
        let category = await prisma.category.findFirst({
            where: { name: 'Descongelar' }
        });

        if (!category) {
            category = await prisma.category.create({
                data: {
                    name: 'Descongelar',
                    nameEs: 'Descongelar',
                    type: 'TASK',
                    department: 'FOOD'
                }
            });
            console.log("Created Category 'Descongelar' (TASK). ID:", category.id);
        } else {
            console.log("Found existing Category 'Descongelar'. ID:", category.id);
            // Ensure type is TASK
            if (category.type !== 'TASK') {
                await prisma.category.update({
                    where: { id: category.id },
                    data: { type: 'TASK' }
                });
                console.log("Updated Category type to 'TASK'.");
            }
        }

        console.log("Updating Tasks...");
        for (const [oldName, newName] of Object.entries(RENAME_MAP)) {
            // Find by OLD name
            let task = await prisma.ingredient.findFirst({
                where: { name: oldName }
            });

            if (task) {
                console.log(`Renaming '${oldName}' -> '${newName}'...`);
                await prisma.ingredient.update({
                    where: { id: task.id },
                    data: {
                        name: newName,
                        categoryId: category.id
                    }
                });
            } else {
                // If not found by old name, check if it's already using the new name
                let newlyNamedTask = await prisma.ingredient.findFirst({
                    where: { name: newName }
                });
                if (newlyNamedTask) {
                    console.log(`Task '${newName}' already exists. Updating its category...`);
                    await prisma.ingredient.update({
                        where: { id: newlyNamedTask.id },
                        data: { categoryId: category.id }
                    });
                } else {
                    console.log(`WARNING: Task '${oldName}' NOT found in DB. Skipping.`);
                }
            }
        }

        console.log("Done updating database.");
    } catch (e) {
        console.error("Error migrating tasks:", e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
