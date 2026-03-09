import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function check() {
    const list = await prisma.ingredient.findMany({ where: { categoryId: 'cmlvqy7zg001j6dexsxntce7o' } });
    const groups = new Map<string, any[]>();
    for (const ing of list) {
        const name = ing.name.toLowerCase().replace(/[^a-z]/g, '');
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name)!.push(ing.name);
    }
    for (const [k, v] of groups.entries()) {
        if (v.length > 1) {
            console.log(`Potential Dup: ${v.join(' | ')}`);
        }
    }

    // exact matches?
    const g2 = new Map<string, any[]>();
    for (const ing of list) {
        const name = ing.name.toLowerCase().trim();
        if (!g2.has(name)) g2.set(name, []);
        g2.get(name)!.push(ing.name);
    }
    for (const [k, v] of g2.entries()) {
        if (v.length > 1) {
            console.log(`EXACT Dup: ${v.join(' | ')}`);
        }
    }
}

check().catch(console.error).finally(() => prisma.$disconnect());
