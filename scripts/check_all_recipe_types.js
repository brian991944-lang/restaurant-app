const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.digitalRecipe.findMany().then(r => console.log(r.map(x => x.type))).catch(console.error).finally(() => prisma.$disconnect());
