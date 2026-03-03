import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function check() {
    const ingredients = await prisma.ingredient.findMany({
        where: { name: { contains: 'Huancaina' } }
    });
    console.log("Ingredients:", ingredients.map(i => ({ id: i.id, name: i.name, type: i.type, currentPrice: i.currentPrice, yieldPercent: i.yieldPercent })));

    const menuItems = await prisma.menuItem.findMany({
        where: { name: { contains: 'Huancaina' } },
        include: { recipeIngredients: { include: { ingredient: true } } }
    });
    console.log("MenuItems:", menuItems.map(m => ({
        name: m.name,
        ingredients: m.recipeIngredients.map(ri => ({
            ingName: ri.ingredient.name,
            ingPrice: ri.ingredient.currentPrice,
            ingYield: ri.ingredient.yieldPercent,
            unit: ri.unit, quantity: ri.quantity
        }))
    })));
}

check().finally(() => prisma.$disconnect());
