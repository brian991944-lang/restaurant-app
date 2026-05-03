const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.$queryRaw`
  SELECT column_name
  FROM information_schema.columns
  WHERE table_name = 'DigitalRecipe';
`.then(console.log).catch(console.error).finally(() => prisma.$disconnect());
