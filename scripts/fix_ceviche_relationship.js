const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
    try {
        console.log("Analyzing 'Descongelar Pescado Ceviche'...");

        const cevicheTask = await prisma.ingredient.findFirst({
            where: { name: 'Descongelar Pescado Ceviche' },
            include: { prepItems: true } // see if it has children 
        });

        if (cevicheTask) {
            console.log(`Found: ${cevicheTask.name} (Type: ${cevicheTask.type})`);
            console.log(`Children Tasks depending on it: ${cevicheTask.prepItems.length}`);

            for (const child of cevicheTask.prepItems) {
                console.log(` - Child: ${child.name} (Type: ${child.type})`);

                // Detach children because Descongelar should be a leaf task, not a parent Base Ingredient
                await prisma.ingredient.update({
                    where: { id: child.id },
                    data: { parentId: null }
                });
                console.log(`   -> Detached child '${child.name}' from 'Descongelar Pescado Ceviche'.`);
            }

            // Also ensure it is typed correctly
            const parentCat = await prisma.category.findUnique({ where: { id: cevicheTask.categoryId } });
            console.log(`Current Category: ${parentCat?.name || 'Unknown'} (Type: ${parentCat?.type})`);

        } else {
            console.log("Not found.");
        }

    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
