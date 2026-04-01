const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const doc = await prisma.digitalRecipe.findFirst({
        where: { recipeCode: 'SAL-002' }
    });
    if (!doc) {
        console.error("Recipe SAL-002 not found");
        return;
    }

    const procedureSteps = [
        "**Preparar Vegetales:** Picar la cebolla roja, el ajo y el rocoto en trozos medianos (no es necesario que sean uniformes, ya que se licuarán).",
        "**Saltear:** Calentar una sartén grande o una olla a fuego medio-alto con una cantidad generosa de aceite vegetal (80 ml). Añadir la cebolla, el ajo y el rocoto.",
        "**Dorar:** Saltear los vegetales, moviendo ocasionalmente, hasta que estén suaves y bien dorados. Este paso es crucial para desarrollar la base de sabor de la crema.",
        "**Sazonar en Sartén:** Una vez dorados los vegetales, agregar la sal (1 tbsp) y la pimienta negra (1 tbsp) directamente a la sartén. Cocinar por 1 minuto más para despertar el aroma de la pimienta.",
        "**Licuar:** Transferir todo el contenido de la sartén a una licuadora de alta potencia.",
        "**Añadir Líquidos y Espesante:** Agregar a la licuadora las 2 latas de leche evaporada y las 15 galletas de soda.",
        "**Procesar:** Licuar todo a alta velocidad durante aproximadamente 3 minutos, o hasta que la crema esté completamente lisa y sin grumos. Es importante verificar la textura.",
        "**Enfriar y Almacenar:** Transferir la crema a un recipiente limpio, dejar enfriar y luego almacenar en refrigeración."
    ];

    const chefNotes = `
- **Vida Útil:** Calidad óptima de 3-4 días. Vida útil máxima (seguridad) de 5 días. Guardar en recipiente limpio, tapado y etiquetado en refrigeración.
- **Consistencia:** La crema espesará considerablemente una vez que se enfríe por completo en el refrigerador.
`.trim();

    await prisma.digitalRecipe.update({
        where: { id: doc.id },
        data: {
            procedureJson: JSON.stringify(procedureSteps),
            chefNotes: chefNotes
        }
    });

    console.log("Updated SAL-002 procedure and notes!");
}

main().catch(console.error).finally(() => prisma.$disconnect());
