const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient({
    datasources: {
        db: {
            url: "postgresql://postgres.abijsgttguoyyamoqcxg:lapaz12%23SUPA@aws-0-us-west-2.pooler.supabase.com:6543/postgres?pgbouncer=true"
        }
    }
});
prisma.ingredient.count().then(console.log).catch(console.error).finally(() => prisma.$disconnect());
