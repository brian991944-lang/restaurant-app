const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const procedure = [
        "**Parte 1: Preparar la Base de Galleta**\n**Derretir la Mantequilla:** Pesar los 200 g de mantequilla y derretirla completamente (aprox. 1.5 minutos en el microondas, o en una olla pequeña).",
        "**Triturar la Galleta:** Pesar los 480 g de galletas y triturarlas hasta obtener un polvo fino. *(Nota: Si se usa Thermomix, son 10 segundos a velocidad 5.5)*.",
        "**Mezclar la Base:** En un bol grande, combinar la galleta triturada con la mantequilla derretida. Mezclar bien hasta que toda la galleta esté humedecida y tenga la textura de arena mojada.",
        "**Formar las Bases:** Pesar 50 g de esta mezcla en cada uno de los 12 moldes o vasos de postre. Presionar firmemente con una cuchara o el fondo de un vaso para crear una base compacta. Refrigerar mientras se prepara el relleno.",
        "**Parte 2: Preparar el Relleno de Cheesecake**\n**Hidratar la Gelatina:** Mientras se preparan las bases, colocar las 20 g de hojas de gelatina en una bandeja con abundante agua y hielo. Dejar que se hidraten y ablanden por completo (aprox. 5-10 minutos).",
        "**Batir el Queso:** En el bol de una batidora con el accesorio de pala, colocar el queso crema (500 g) a temperatura ambiente y el azúcar en polvo (220 g). Batir a velocidad baja por 15 segundos y luego a velocidad media hasta que la mezcla esté suave y sin grumos.",
        "**Disolver la Gelatina:** Retirar las hojas de gelatina del agua helada y escurrirlas muy bien con las manos para quitar todo el exceso de agua. Ponerlas en una olla muy pequeña con 3 TBSP de agua y calentar a fuego mínimo, moviendo constantemente, solo hasta que la gelatina se disuelva por completo. Retirar del fuego de inmediato.",
        "**Incorporar Ingredientes:** Con la batidora a velocidad baja, añadir la leche condensada (1 lata) al queso crema y mezclar hasta integrar. Luego, verter la gelatina disuelta en forma de hilo, seguido por el concentrado de chicha morada (400 g).",
        "**Mezclar Final:** Mezclar todo hasta que el color sea uniforme y no queden grumos. No sobrebatir. La mezcla debe quedar lisa y homogénea.",
        "**Parte 3: Ensamblaje y Refrigeración**\n**Rellenar las Bases:** Retirar los moldes con las bases de galleta del refrigerador. Pesar y verter 125 g de la mezcla de cheesecake sobre cada base.",
        "**Refrigerar:** Tapar los postres (con film o sus propias tapas) y llevar a la nevera. Dejar que cuajen y se asienten por un mínimo de 4 a 6 horas, o idealmente durante toda la noche."
    ];

    const result = await prisma.digitalRecipe.update({
        where: { recipeCode: 'LB-002' },
        data: {
            procedureJson: JSON.stringify(procedure)
        }
    });

    console.log("Updated effectively:", result.name);
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
