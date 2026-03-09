import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function check() {
    const cats = await prisma.category.findMany({ where: { name: { contains: 'prod', mode: 'insensitive' } } });
    console.log("Prod Categories:");
    console.log(cats.map(c => ({ id: c.id, name: c.name, nameEs: c.nameEs })));

    const veg = await prisma.category.findMany({ where: { name: { contains: 'vege', mode: 'insensitive' } } });
    console.log("Veg Categories:");
    console.log(veg.map(c => ({ id: c.id, name: c.name, nameEs: c.nameEs })));
}

check().catch(console.error).finally(() => prisma.$disconnect());
