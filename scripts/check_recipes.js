const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.digitalRecipe.count().then(console.log).catch(console.error).finally(() => prisma.$disconnect());
