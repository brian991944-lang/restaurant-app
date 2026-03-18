const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const overview = 'Una explosión de tradición peruana en formato finger food. Estas croquetas encapsulan la cremosidad aterciopelada y el picante sutil del Ají de Gallina clásico bajo una costra de panko extra crujiente. Diseñadas para fundirse en el paladar, representan el equilibrio perfecto entre técnica de alta cocina y el alma del sabor casero de Lima.';
    const procedure = [
        "**Cocción del Pollo:** Hervir agua con tomates (2kg), pechugas (40 lbs), sal y caldo (340g c/u). Cocinar hasta 63°C interna (aprox. 15 min). Deshilachar y reservar caldo.",
        "**Panade (Espesante):** Cubos de pan francés (1cm) + 1.5L leche evaporada + 1.5L leche entera + 3L caldo. Licuar y reservar.",
        "**Blanquear el Ají Amarillo:** Cocinar 3.6kg de pasta de ají por 15 min a fuego medio. Escurrir.",
        "**Aderezo Principal:** Sofreír 2.5kg cebolla roja y 400g ajo. Añadir 1.5 TBSP comino tras 10 min.",
        "**Unión de la Salsa:** Combinar sofrito, ají, panade y 300g c/u de nueces/almendras. Licuar. Añadir 1.5 TBSP nuez moscada, 140g sal, 50g ajinomoto, 4 TBSP bijol y 400g Queso Fresco. Licuar hasta textura aterciopelada.",
        "**Unión con el Pollo:** Mezclar pollo con crema reducida y 400g Queso Parmesano. Refrigerar hasta el día siguiente para ganar cuerpo.",
        "**Empanizado:** Formar bolitas de 125g. Pasar por harina (200g), huevo batido (1 caja 2 lbs) y panko (100g). Almacenar 15 unidades por bandeja y congelar."
    ];
    const notes = "**Vida Útil:** 30-45 días para calidad óptima (evitar olor a congelador). Máximo 3 meses a -18°C.\n\n**Manejo:** NO RE-CONGELAR una vez descongeladas.\n\n**Fritura:** Freír directo de congelado a 350°F (180°C) por 5-6 minutos.\n\n**Tip de Servicio:** Si el centro sigue frío, terminar 2-3 min en horno/salamandra. Temp interna meta: 165°F+.";

    const result = await prisma.digitalRecipe.update({
        where: { recipeCode: 'LB-003' },
        data: {
            overview: overview,
            procedureJson: JSON.stringify(procedure),
            chefNotes: notes
        }
    });

    console.log("Updated effectively:", result.name);
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
