import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
prisma.ingredient.findFirst({ where: { name: 'Huancaina' } }).then(r => console.log('CurrentPrice:', r?.currentPrice)).finally(() => prisma.$disconnect());
