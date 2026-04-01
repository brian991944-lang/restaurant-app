const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const procedure = [
        "**Día 1: Marinado**",
        "Preparar la Carne: Colocar los 18 kg de chancho cortado en cuadrados.",
        "Hacer la Marinada: En un bol aparte, combinar vinagre, sal, ajinomoto, comino, pimienta, canela, orégano, achiote, ají panca, ajo licuado, tallos de hierbabuena y 6 litros de agua. Mezclar hasta obtener un líquido homogéneo.",
        "Marinar: Verter la marinada sobre el chancho y masajear para asegurar una cobertura completa.",
        "Reposar: Tapar y almacenar en refrigeración entre 12 y 24 horas.",
        "**Día 2: Cocción y Porcionado**",
        "Cocción Lenta: Transferir la carne y su marinada a ollas grandes. Llevar a hervor y luego bajar el fuego al mínimo.",
        "Cocinar: Dejar cocinar tapado por aproximadamente 4 horas hasta que la carne esté extremadamente tierna.",
        "Enfriar: Retirar la carne del líquido y dejar enfriar a temperatura ambiente para manipularla.",
        "Pesar Porciones: Separar en porciones individuales de 300 g en contenedores o bolsas de vacío.",
        "Almacenar: Etiquetar con nombre y fecha, y refrigerar inmediatamente."
    ];

    const chefNotes = `Almacenamiento: Vida útil máxima de 4 días en refrigeración o 2 meses en congelación.

Corte de Carne: Funciona mejor con panceta de cerdo (pork belly) o pierna con piel para asegurar una buena proporción de grasa.`;

    const recipes = await prisma.digitalRecipe.findMany({
        where: { name: { contains: 'Chicharron', mode: 'insensitive' } }
    });

    if (recipes.length > 0) {
        for (const recipe of recipes) {
            await prisma.digitalRecipe.update({
                where: { id: recipe.id },
                data: {
                    procedureJson: JSON.stringify(procedure),
                    chefNotes: chefNotes
                }
            });
            console.log('Successfully updated ' + recipe.name + ' (' + recipe.recipeCode + ')!');
        }
    } else {
        console.log('Chicharron recipe not found.');
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
