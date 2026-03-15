const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function addCategoryColumn() {
  try {
    console.log("Adding column...");
    await prisma.$executeRawUnsafe(`ALTER TABLE "DigitalRecipe" ADD COLUMN "categoryId" TEXT;`);
    console.log("Column added successfully or already exists.");
  } catch (err) {
    console.error("Column might already exist or error:", err.message);
  } finally {
    const list = await prisma.digitalRecipe.findMany({
      where: { name: { contains: 'Huancaina' } }
    });
    console.log(JSON.stringify(list, null, 2));
    await prisma.$disconnect();
  }
}

addCategoryColumn();
