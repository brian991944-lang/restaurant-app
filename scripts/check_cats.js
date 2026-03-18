const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.category.findMany({ where: { department: 'RECIPE' } }).then(r => console.log(JSON.stringify(r))).finally(() => p.$disconnect());
