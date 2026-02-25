const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    await prisma.prepAssignment.deleteMany();
    await prisma.schedule.deleteMany();
    await prisma.recurringPrepRule.deleteMany();
    console.log('Deleted mock tasks');
}

main()
    .catch(e => { console.error(e); process.exit(1); })
    .finally(async () => { await prisma.$disconnect(); });
