const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const procedure = [
        "Combinar: Colocar todos los ingredientes en el vaso de una licuadora: ajo (90g), pasta de ají panca (275g), orégano, sal, comino, pimienta, sillao (75g), aceite (20g), vinagre blanco (310g) y la gaseosa negra (180g).",
        "Licuar: Procesar a alta velocidad hasta obtener una salsa completamente lisa y homogénea."
    ];

    const chefNotes = `Uso Principal (Marinada): Diseñada para marinar carnes, tradicionalmente corazón de res. Se recomienda marinar por un mínimo de 2-4 horas, o idealmente toda la noche en refrigeración para un sabor más profundo.

Almacenamiento y Vida Útil: Gracias a su alta acidez y contenido de sal, es bastante estable. Guardar en recipiente hermético y etiquetado en refrigeración.

Calidad Óptima: 5-7 días.
Vida Útil Máxima: 10 días.`;

    const recipe = await prisma.digitalRecipe.update({
        where: { recipeCode: 'SAL-005' },
        data: {
            procedureJson: JSON.stringify(procedure),
            chefNotes: chefNotes
        }
    });

    console.log('Successfully updated SAL-005!');
    console.log('Current ingredientsJson:');
    try {
        const ingredients = JSON.parse(recipe.ingredientsJson);
        ingredients.forEach(i => console.log(`- ${i.ingredient}: ${i.quantity} ${i.metric}`));
    } catch (e) {
        console.log(recipe.ingredientsJson);
    }
}

main()
    .catch(e => {
        console.error(e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
