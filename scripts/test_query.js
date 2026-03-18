const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.digitalRecipe.findMany({
    orderBy: { recipeCode: 'asc' },
    include: { linkedTasks: true, category: true }
}).then(r => console.log(JSON.stringify(r))).catch(e => console.error(e)).finally(() => prisma.$disconnect());
