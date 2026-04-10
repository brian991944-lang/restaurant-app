const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const doc = await prisma.digitalRecipe.findFirst({
        where: { recipeCode: 'SAL-006' }
    });
    if (!doc) {
        console.error("Recipe SAL-006 not found");
        return;
    }

    const procedureSteps = [
        "**Sofrito:** Calentar los 10g de aceite y sudar los 60g de cebolla con los 10g de ajo hasta que estén traslúcidos.",
        "**Desglasado:** Añadir los 15g de pisco para levantar los sabores y dejar reducir el alcohol por 30 segundos. Importante: Dejar enfriar antes del siguiente paso.",
        "**Procesado Base:** Licuar los 175g de aceitunas con el sofrito enfriado hasta obtener una pasta fina y homogénea.",
        "**Emulsión Final:** Incorporar los 235g de mayonesa y usar la licuadora en modo 'pulso' solo hasta homogeneizar el color y la textura. Evitar sobre-procesar para no calentar la emulsión."
    ];

    await prisma.digitalRecipe.update({
        where: { id: doc.id },
        data: {
            procedureJson: JSON.stringify(procedureSteps)
        }
    });

    console.log("Updated SAL-006 (Mayonesa de Aceituna) procedure steps!");
}

main().catch(console.error).finally(() => prisma.$disconnect());
