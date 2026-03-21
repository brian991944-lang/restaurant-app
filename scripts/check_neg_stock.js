require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
    try {
        const item = await prisma.ingredient.findFirst({
            where: { name: { contains: 'Causa' } }
        });
        console.log('Ingrediente:', item.name);
        console.log('Permite Stock Negativo (DB):', item.allowNegativeStock);

        // Let's modify it to toggle
        const updated = await prisma.ingredient.update({
            where: { id: item.id },
            data: { allowNegativeStock: !item.allowNegativeStock }
        });
        console.log('Actualizado a:', updated.allowNegativeStock);

        // Revert it
        await prisma.ingredient.update({
            where: { id: item.id },
            data: { allowNegativeStock: item.allowNegativeStock }
        });
    } catch (e) {
        console.error('Error:', e);
    }
}
main().finally(() => prisma.$disconnect());
