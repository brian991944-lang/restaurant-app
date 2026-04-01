const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const doc = await prisma.digitalRecipe.findFirst({
        where: { recipeCode: 'BAS-001' }
    });
    if (!doc) {
        console.error("Recipe BAS-001 not found");
        return;
    }

    const procedureSteps = [
        "**Mise en Place (Mezcla Inicial):** En un bowl grande, combinar todos los ingredientes sólidos y líquidos (Zumo de limón, pescado, cebolla, apio, ajo, cilantro, jengibre, ají limo, sal y ajinomoto). **No agregar el hielo todavía.**",
        "**Licuado:** Usar la licuadora de mano (mixer de inmersión). Procesar a **velocidad 3** hasta que todo esté completamente triturado e integrado en una mezcla homogénea.\n\n*Nota:* No licuar en exceso para no calentar la mezcla ni amargar los tallos de cilantro.",
        "**Primer Colado (Choque Térmico):**\n- Preparar un balde de acero inoxidable limpio y colocar los **1,500 g de hielo** en el fondo.\n- Colocar un cernidor (colador) fino sobre el balde.\n- Verter la mezcla licuada a través del cernidor para que caiga directamente sobre el hielo. Esto baja la temperatura al instante.",
        "**Segundo Colado (Refinado):**\n- Inmediatamente después, pasar el líquido (junto con el hielo remanente) por un colador **EXTRA FINO** (chinois o malla fina) hacia un nuevo recipiente limpio.\n- El objetivo es retirar el hielo que no se derritió y cualquier residuo sólido diminuto que haya pasado el primer filtro.",
        "**División y Almacenaje:**\n- **Ceviche Clásico:** Almacenar la mayor parte en un envase de **4 Litros**.\n- **Ceviche Charapa:** Separar **1,100 g** de la base para la preparación específica del ceviche charapa."
    ];

    const chefNotes = `
- **Temperatura Crítica:** El paso del hielo es vital no solo para enfriar, sino para "cortar" ligeramente la potencia del limón y equilibrar la acidez.
- **Pescado:** Al usar las "venas" o recortes oscuros del pescado (que se limpiaron para la jalea), aportamos mucho sabor y hierro, pero si se deja reposar demasiado tiempo antes de licuar, puede oxidarse. Procesar rápido.
- **Almacenamiento:** Mantener siempre refrigerado entre 1°C y 4°C.
- **Vida Útil Óptima:** 24 horas. El zumo de limón cambia su perfil de sabor rápidamente, incluso en esta base. Se recomienda producción diaria.
`.trim();

    await prisma.digitalRecipe.update({
        where: { id: doc.id },
        data: {
            procedureJson: JSON.stringify(procedureSteps),
            chefNotes: chefNotes
        }
    });

    console.log("Updated BAS-001 procedure and notes!");
}

main().catch(console.error).finally(() => prisma.$disconnect());
