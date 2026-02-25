const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const names = ['Tamara C', 'Piero A', 'Diego S', 'Juan Q', 'Brian Y'];

    for (const name of names) {
        // Upsert to not duplicate
        await prisma.user.upsert({
            where: { email: `${name.toLowerCase().replace(' ', '.')}@fusionista.demo` },
            update: {},
            create: {
                name: name,
                email: `${name.toLowerCase().replace(' ', '.')}@fusionista.demo`,
                role: 'KITCHEN'
            }
        });
        console.log(`Ensured user exists: ${name}`);
    }
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
