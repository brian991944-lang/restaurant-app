const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const doc = await prisma.digitalRecipe.findFirst({
        where: { recipeCode: 'SAL-004' }
    });
    if (!doc) {
        console.error("Recipe SAL-004 not found");
        return;
    }

    const procedureSteps = [
        "**Preparación de Vegetales:** Picar el perejil y el cilantro finamente a cuchillo (sin llegar a punto de puré). Cortar la cebolla roja en brunoise fino (2–3 mm) y el pimiento rojo en cubos pequeños (2–4 mm).",
        "**Base de Sabor:** En un bowl amplio, mezclar el orégano seco, la sal y la pimienta negra. Incorporar el vinagre blanco y dejar reposar de 5 a 10 minutos para hidratar las especias secas y disolver la sal.",
        "**Integración:** Agregar la cebolla roja y el pimiento rojo a la base líquida. Mezclar uniformemente para que los vegetales comiencen a absorber la acidez.",
        "**Incorporación de Hierbas:** Añadir el perejil y el cilantro frescos. Mezclar con cuidado, envolviendo los ingredientes sin comprimir ni aplastar las hojas para no magullarlas.",
        "**Emulsión:** Incorporar el aceite gradualmente. Mezclar suavemente con una cuchara o espátula hasta integrar por completo. No batir ni procesar en máquina.",
        "**Reposo (Crucial):** Refrigerar por un mínimo de 2 horas. El punto óptimo de ensamblaje de sabores y textura se alcanza dejándolo reposar entre 12 y 24 horas antes de su primer uso."
    ];

    const chefNotes = `
- **Vida Útil:** Mantener siempre refrigerado en recipiente hermético. Consumir en un máximo de 3 a 5 días. Después de este tiempo, las hierbas pierden su frescura y verdor vibrante.
- **Técnica:** Evitar completamente el uso de procesador de alimentos. Un cuchillo afilado hace cortes limpios; la máquina machaca y genera un sabor amargo.
- **Manejo de Cebolla:** Si el lote de cebolla roja está muy intenso, enjuagar brevemente en agua fría y secar bien antes de usar.
- **Ajuste de Aceite:** La cantidad de aceite puede variar entre 250 g y 350 g, dependiendo de la fluidez exacta que busques.
- **Servicio:** Es una emulsión inestable. Es obligatorio remover y mezclar bien la salsa antes de cada servicio.
`.trim();

    await prisma.digitalRecipe.update({
        where: { id: doc.id },
        data: {
            procedureJson: JSON.stringify(procedureSteps),
            chefNotes: chefNotes
        }
    });

    console.log("Updated SAL-004 procedure and notes!");
}

main().catch(console.error).finally(() => prisma.$disconnect());
