const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const doc = await prisma.digitalRecipe.findFirst({
        where: { recipeCode: 'SAL-003' }
    });
    if (!doc) {
        console.error("Recipe SAL-003 not found");
        return;
    }

    const procedureSteps = [
        "**Preparar ingredientes:** Limpiar el ají amarillo retirando venas y semillas. Pelar los dientes de ajo y cortar la cebolla dorada en cubos pequeños. Separar hojas y tallos tiernos del perejil y el culantro.",
        "**Saltear base aromática:** En una sartén caliente, añadir un chorrito de aceite vegetal. Incorporar la cebolla, el ajo y el ají amarillo. Saltear a fuego medio-alto por 3–5 minutos, hasta que estén fragantes y ligeramente dorados.",
        "**Añadir hierbas:** Incorporar el perejil y el culantro, salteando por 30–40 segundos para resaltar aromas sin marchitar en exceso.",
        "**Licuar:** Transferir la mezcla caliente a una licuadora. Añadir el queso fresco, 1.5 latas de leche evaporada, la sal y las galletas de soda (de una en una).",
        "**Emulsionar:** Licuar e ir añadiendo el aceite en hilo fino hasta obtener una textura cremosa y estable. Ajustar textura con la 0.5 lata restante de leche evaporada si es necesario.",
        "**Ajustar y servir:** Probar y rectificar sal. Servir fresca como acompañamiento."
    ];

    const chefNotes = `
- **Servicio:** Servir recién hecha para preservar el color verde vivo de las hierbas. Ideal para acompañar carnes a la parrilla, papas sancochadas, empanadas o panes.
- **Conservación:** Guardar en recipiente hermético, refrigerar y consumir en máximo 3 días.
- **Tip Pro:** Para suavizar el picante, se puede blanquear el ají antes de saltearlo.
`.trim();

    await prisma.digitalRecipe.update({
        where: { id: doc.id },
        data: {
            procedureJson: JSON.stringify(procedureSteps),
            chefNotes: chefNotes
        }
    });

    console.log("Updated SAL-003 procedure and notes!");
}

main().catch(console.error).finally(() => prisma.$disconnect());
