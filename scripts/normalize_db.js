const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const cleaningRules = [
    { pattern: /Heavy Whipping Cream.*|Cream, Heavy.*/gi, replacement: 'Heavy Cream' },
    { pattern: /.*Burrata Cheese.*/gi, replacement: 'Burrata Cheese' },
    { pattern: /.*Eggs?.*Dozen.*/gi, replacement: 'Eggs' },
    { pattern: /.*ONION RED.*/gi, replacement: 'Red Onion' },
    { pattern: /.*ONION SPANISH.*/gi, replacement: 'Red Onion' },
    { pattern: /.*CHICKEN BRST.*/gi, replacement: 'Chicken Breast' }
];

async function main() {
    console.log("Starting AI-driven (Mock) Data Normalization Script...");

    const items = await prisma.ingredient.findMany();
    let updatedCount = 0;

    for (const item of items) {
        const originalName = item.name;
        let newName = originalName;

        // Apply rules
        for (const rule of cleaningRules) {
            if (rule.pattern.test(originalName)) {
                newName = rule.replacement;
                break;
            }
        }

        if (newName !== originalName) {
            console.log(`Normalizing: "${originalName}" -> "${newName}"`);

            // Check if aliases exists, parse it, add to it, stringify
            let aliasesArray = [];
            if (item.aliases) {
                try {
                    aliasesArray = JSON.parse(item.aliases);
                } catch (e) {
                    aliasesArray = [];
                }
            }

            if (!aliasesArray.includes(originalName)) {
                aliasesArray.push(originalName);
            }

            await prisma.ingredient.update({
                where: { id: item.id },
                data: {
                    name: newName,
                    aliases: JSON.stringify(aliasesArray)
                }
            });

            updatedCount++;
        }
    }

    console.log(`Sanitization complete! Updated ${updatedCount} ingredients.`);
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
