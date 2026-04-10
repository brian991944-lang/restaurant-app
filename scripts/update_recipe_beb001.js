const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const doc = await prisma.digitalRecipe.findFirst({
        where: { recipeCode: 'BEB-001' }
    });
    if (!doc) {
        console.error("Recipe BEB-001 not found");
        return;
    }

    const procedureSteps = [
        "**Preparación Inicial:** Lavar bien el maíz morado y las cáscaras de piña. Romper ligeramente el maíz usando un rodillo o mortero (solo quebrar los granos, sin pulverizar). Cortar la manzana en cuartos grandes (retirando las pepas) y la piña en trozos medianos.",
        "**Hervida 1 (Extracción Principal):** En una olla grande, agregar 16 Litros de agua fría, el maíz morado, la manzana, la piña, canela, clavo de olor y anís estrella. Hervir a fuego alto. Al romper hervor, bajar a fuego medio y cocinar tapado parcialmente por 60 minutos.",
        "**Primer Colado:** Colar el líquido (Extracto 1) y reservarlo. Guardar los sólidos (maíz y fruta) para la siguiente extracción.",
        "**Hervida 2 (Segunda Extracción):** Regresar los sólidos a la olla. Agregar 12 Litros de agua, canela y clavo de olor. Hervir y cocinar a fuego medio por 40 minutos.",
        "**Segundo Colado:** Colar el líquido y mezclarlo con el Extracto 1. Reservar sólidos.",
        "**Hervida 3 (Aroma Final):** En la olla con los sólidos, agregar 8 Litros de agua, canela, clavo de olor y anís estrella. Hervir y cocinar por 25 a 30 minutos.",
        "**Colado Final y Unificación:** Colar y descartar sólidos. Mezclar con los extractos anteriores.",
        "**Rendimiento Esperado:** Aproximadamente 26-28 Litros de base."
    ];

    await prisma.digitalRecipe.update({
        where: { id: doc.id },
        data: {
            procedureJson: JSON.stringify(procedureSteps),
            yield: "Aproximadamente 26-28 Litros de base."
        }
    });

    console.log("Updated BEB-001 (Chicha Morada - Esencia) procedure steps!");
}

main().catch(console.error).finally(() => prisma.$disconnect());
