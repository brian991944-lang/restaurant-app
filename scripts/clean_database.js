const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
    console.log("Cleaning database tasks and logs...");

    // Delete logs and tasks in dependency order
    await prisma.prepAssignment.deleteMany({});
    await prisma.schedule.deleteMany({});
    await prisma.inventoryTransaction.deleteMany({});
    await prisma.dailySales.deleteMany({});
    await prisma.processedCloverModifier.deleteMany({});
    await prisma.processedCloverLineItem.deleteMany({});
    await prisma.recurringPrepRule.deleteMany({});

    console.log("Database cleaned successfully.");
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
