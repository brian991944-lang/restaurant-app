import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function run() {
    // 1. Get dates using EST bounds exactly as backend does
    const satStr = '2026-02-28';
    const numSatStart = new Date(`${satStr}T00:00:00-05:00`);
    const numSatEnd = new Date(`${satStr}T23:59:59.999-05:00`);

    const friStr = '2026-02-27';
    const numFriStart = new Date(`${friStr}T00:00:00-05:00`);
    const numFriEnd = new Date(`${friStr}T23:59:59.999-05:00`);

    console.log('Searching for Saturday schedules...');
    const satSchedules = await prisma.schedule.findMany({
        where: { date: { gte: numSatStart, lte: numSatEnd } },
        include: { prepAssignments: true }
    });
    console.log(`Found ${satSchedules.length} Saturday schedules.`);

    const friSchedules = await prisma.schedule.findMany({
        where: { date: { gte: numFriStart, lte: numFriEnd } }
    });

    let friSchedule = friSchedules[0];
    if (!friSchedule) {
        friSchedule = await prisma.schedule.create({
            data: {
                date: new Date(`${friStr}T12:00:00-05:00`),
                createdBy: 'Migration',
                assignedTo: 'MorningCrew'
            }
        });
        console.log(`Created new Friday schedule ${friSchedule.id}`);
    } else {
        console.log(`Using existing Friday schedule ${friSchedule.id}`);
    }

    let movedCount = 0;
    for (const satSchedule of satSchedules) {
        for (const assignment of satSchedule.prepAssignments) {
            await prisma.prepAssignment.update({
                where: { id: assignment.id },
                data: { scheduleId: friSchedule.id }
            });
            movedCount++;
        }
        await prisma.schedule.delete({ where: { id: satSchedule.id } });
    }

    console.log(`Moved ${movedCount} assignments from Feb 28 to Feb 27.`);
}

run().catch(console.error).finally(() => prisma.$disconnect());
