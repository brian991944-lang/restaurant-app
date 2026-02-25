const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const data = [
    { cat: 'Bases', ing: 'Ceviche', task: 'Leche Base - Preparar' },
    { cat: 'Bases', ing: 'Ceviche', task: 'Leche Charapa - Preparar' },
    { cat: 'Bases', ing: 'Fondo Bruno', task: 'Fondo Bruno - Preparar y Porcionar' },
    { cat: 'Bases', ing: 'Fondo de Mariscos', task: 'Fondo de Mariscos - Preparar y Porcionar' },
    { cat: 'Bases', ing: 'Pesto', task: 'Pesto - Preparar y Porcionar' },
    { cat: 'Carnes', ing: 'Cerdo - Chicharron', task: 'Chicharron - Marinar (1 Dia)' },
    { cat: 'Carnes', ing: 'Cerdo - Chicharron', task: 'Chicharron - Hervir, Porcionar y Congelar' },
    { cat: 'Carnes', ing: 'Churrasco', task: 'Churrasco - Porcionar' },
    { cat: 'Carnes', ing: 'Lomo', task: 'Lomo - Cortar y Porcionar' },
    { cat: 'Carnes', ing: 'Lomo', task: 'Lomo Chaufa - Cortar y Porcionar' },
    { cat: 'Carnes', ing: 'Pollo', task: 'Croquetas de Pollo - Preparar Aji de Gallina' },
    { cat: 'Carnes', ing: 'Pollo', task: 'Croquetas de Pollo - Empanizar Croquetas' },
    { cat: 'Carnes', ing: 'Pollo', task: 'Croquetas de Pollo - Porcionar y Congelar Croquetas' },
    { cat: 'Carnes', ing: 'Pollo', task: 'Pollo Causa - Hervir, Porcionar y Congelar' },
    { cat: 'Carnes', ing: 'Pollo', task: 'Pollo Chaufa - Porcionar y Congelar' },
    { cat: 'Otros', ing: 'Huevo', task: 'Huevo Entero - Cocinar Huevo Entero' },
    { cat: 'Otros', ing: 'Huevo', task: 'Huevo Liquido - Preparar y Picar Huevo Chaufa' },
    { cat: 'Pasta y Arroz', ing: 'Arroz', task: 'Arroz Blanco - Preparar' },
    { cat: 'Pasta y Arroz', ing: 'Linguini', task: 'Linguini - Preparar y Porcionar' },
    { cat: 'Pasta y Arroz', ing: 'Gnocchi', task: 'Gnocchi - Preparar y Porcionar' },
    { cat: 'Postres', ing: 'Arroz con Leche', task: 'Arroz con Leche - Preparar' },
    { cat: 'Postres', ing: 'Cheesecake Chicha Morada', task: 'Cheesecake Chicha Morada - Preparar' },
    { cat: 'Postres', ing: 'Cheesecake Maracuya', task: 'Cheesecake Maracuya - Preparar' },
    { cat: 'Salsas', ing: 'Huancaina', task: 'Huancaina - Preparar' },
    { cat: 'Salsas', ing: 'Maracuya Salmon', task: 'Maracuya Salmon - Preparar' },
    { cat: 'Salsas', ing: 'Mayonesa de Aceituna', task: 'Mayonesa de Aceituna - Preparar' },
    { cat: 'Salsas', ing: 'Mayonesa de Ajo', task: 'Mayonesa de Ajo - Preparar' },
    { cat: 'Salsas', ing: 'Rocoto', task: 'Rocoto - Preparar' },
    { cat: 'Salsas', ing: 'Uchucuta', task: 'Uchucuta - Preparar' },
    { cat: 'Seafood', ing: 'Camaron', task: 'Camaron - Hervir para Ceviche' },
    { cat: 'Seafood', ing: 'Camaron', task: 'Camaron - Porcionar y Congelar' },
    { cat: 'Seafood', ing: 'Pescado', task: 'Pescado Ceviche - Cortar, Porcionar y Congelar' },
    { cat: 'Seafood', ing: 'Pescado', task: 'Pescado Jalea - Cortar, Porcionar y Congelar' },
    { cat: 'Seafood', ing: 'Pescado', task: 'Pescado Macho - Empanizar' },
    { cat: 'Seafood', ing: 'Pulpo', task: 'Pulpo - Hervir' },
    { cat: 'Seafood', ing: 'Pulpo', task: 'Pulpo - Picar para ceviche y Congelar' },
    { cat: 'Seafood', ing: 'Pulpo', task: 'Pulpo - Porcionar Tentaculos' },
    { cat: 'Seafood', ing: 'Salmon', task: 'Salmon - Porcionar y Congelar' },
    { cat: 'Seafood', ing: 'Salmon', task: 'Salmon Puntas - Congelar' },
    { cat: 'Vegetales', ing: 'Camote', task: 'Camote - Cocinar' },
    { cat: 'Vegetales', ing: 'Canchita', task: 'Canchita - Preparar' },
    { cat: 'Vegetales', ing: 'Cebolla China', task: 'Cebolla China - Picar para Chaufa, y Almacenar' },
    { cat: 'Vegetales', ing: 'Cebolla Roja', task: 'Cebolla Roja - Picar Cebolla Lomo' },
    { cat: 'Vegetales', ing: 'Cebolla Roja', task: 'Cebolla Roja - Picar Cebolla Ceviche' },
    { cat: 'Vegetales', ing: 'Chalaquita', task: 'Chalaquita - Preparar' },
    { cat: 'Vegetales', ing: 'Choclo', task: 'Choclo - Cocinar' },
    { cat: 'Vegetales', ing: 'Cilantro', task: 'Cilantro - Picar' },
    { cat: 'Vegetales', ing: 'Limon', task: 'Limon- Exprimir y Empaquetar al Vacio' },
    { cat: 'Vegetales', ing: 'Papa Amarilla', task: 'Papa Amarilla - Cocinar y Refrigerar' },
    { cat: 'Vegetales', ing: 'Papa Amarilla', task: 'Papa Causa - Preparar, Porcionar y Almacenar' },
    { cat: 'Vegetales', ing: 'Pimiento Rojo', task: 'Pimiento Rojo - Picar en Cubos y Almacenar' },
    { cat: 'Vegetales', ing: 'Platano Maduro', task: 'Platano Maduro - Freir, Porcionar, y Congelar' },
    { cat: 'Vegetales', ing: 'Platano Verde', task: 'Platano Verde - Preparar Tostones y Congelar' },
    { cat: 'Vegetales', ing: 'Platano Verde', task: 'Platano Verde - Preparar Chifles' },
    { cat: 'Vegetales', ing: 'Tomate', task: 'Tomate - Picar tomate lomo' },
    { cat: 'Vegetales', ing: 'Tomate Cherry', task: 'Tomate Cherry - Picar y Ponerlo en Aceite de Oliva' },
    { cat: 'Vegetales', ing: 'Yuca', task: 'Yuca - Cocinar, Picar y Almacenar' },
    { cat: 'Vegetales', ing: 'Zanahoria', task: 'Zanahoria - Rallar Zanahoria Para Ensalada' }
];

async function main() {
    for (const item of data) {
        // 1. Ensure category exists
        let cat = await prisma.category.findFirst({ where: { name: item.cat } });
        if (!cat) {
            cat = await prisma.category.create({
                data: { name: item.cat, department: 'FOOD', autoTranslate: true }
            });
            console.log('Created category', item.cat);
        }

        // 2. Ensure "Ingrediente" exists as RAW type (or PROCESSED) to act as parent
        let parentIng = await prisma.ingredient.findFirst({ where: { name: item.ing } });
        if (!parentIng) {
            parentIng = await prisma.ingredient.create({
                data: {
                    name: item.ing,
                    categoryId: cat.id,
                    type: 'RAW',
                    metric: 'kg', // default
                    currentPrice: 0,
                    yieldPercent: 100
                }
            });
            console.log('Created parent ingredient', item.ing);
        }

        // 3. Ensure "Tarea" (PREP type) exists and points to parent
        let prepTask = await prisma.ingredient.findFirst({ where: { name: item.task, type: 'PREP' } });
        if (!prepTask) {
            await prisma.ingredient.create({
                data: {
                    name: item.task,
                    categoryId: cat.id,
                    type: 'PREP',
                    metric: 'units', // default, can be edited
                    parentId: parentIng.id,
                    currentPrice: 0,
                    yieldPercent: 100
                }
            });
            console.log('Created Prep Task', item.task);
        } else if (!prepTask.parentId) {
            // Link it to the parent if not already linked
            await prisma.ingredient.update({
                where: { id: prepTask.id },
                data: { parentId: parentIng.id, categoryId: cat.id }
            });
            console.log('Updated Prep Task Parent', item.task);
        }
    }
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
