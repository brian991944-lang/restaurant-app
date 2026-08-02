// Seeds the shift checklist sections and tasks.
//
// Idempotent by design: it does nothing at all if ShiftSection already has any
// row, so re-running it can never duplicate the lists or clobber edits made in
// the app. To re-seed from scratch, clear ShiftSection first (tasks cascade).
//
//   node scripts/seedShiftLists.mjs

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Each section: { listType, name, dayOfWeek, sortOrder, tasks }
 * A task is a plain string, or [text, daysOfWeek] when it only applies on
 * certain ISO weekdays.
 */
const SECTIONS = [
    {
        listType: 'APERTURA',
        name: 'Salón',
        dayOfWeek: null,
        sortOrder: 0,
        tasks: [
            'Prender todas las luces del salón',
            'Luces de bar, de pared, 2 tiras de luces led, conectar luces de navidad',
            'Prender 3 parlantes en el salón y sincronizarlos',
            'Bajar sillas y ordenar las mesas',
            'Poner cubiertos en las mesas',
            'Revisar que se tenga 1 paquete de servilletas guardado en la barra',
            'Revisar que se tengan 2 paquetes de toallas de mano guardado en la barra',
            'Revisar que el baño esté limpio para el inicio con suficiente papel y jabón',
            'Barrer las gradas externas',
            'Actualizar la pizarra de salón y de afuera (preguntar a cocina si hay especiales)',
            'Prender las luces del patio (Basement)',
            'Organizar las bebidas y mantener la nevera llena',
            'Mantener llenos los dispensadores de papel',
            'Revisar papel higiénico en el baño',
            'Revisar el espejo y piso del baño y limpiar si es necesario',
            'Sellar bolsas de papel',
            'Limpiar ventanas por dentro y por fuera'
        ]
    },
    {
        listType: 'APERTURA',
        name: 'Patio',
        dayOfWeek: null,
        sortOrder: 1,
        tasks: [
            'Barrer el patio',
            'Barrer la acera',
            'Limpiar la reja de la entrada',
            'Bajar las sillas del patio',
            'Limpiar las mesas y sillas',
            'Limpiar la pared blanca de plástico',
            'Limpiar las llamas',
            'Prender 1 parlante en el patio'
        ]
    },
    {
        listType: 'CIERRE',
        name: 'Cierre',
        dayOfWeek: null,
        sortOrder: 0,
        tasks: [
            'Secar vasos y copas - revisar que no tengan manchas de labial o agua',
            'Secar platos azules',
            'Secar containers de canchita',
            'Secar y doblar cubiertos',
            'Rellenar la nevera y la barra de sodas',
            'Limpiar las 2 máquinas de café',
            'Jarra de café: botar el filtro usado, lavar y secar la jarra',
            'Máquina de expresso: botar el café usado, botar el agua y lavar la base y la lechera',
            'Lavar y secar los cubos de agua de la fuente de refrescos',
            'Revisar y escribir en la pizarra de preparaciones si se necesita',
            'Canchita, chicha morada, o jarabe para el día siguiente',
            'Anotar si falta algo en la lista de compras. Dejarla firmada y con nombre',
            'Cerrar caja y firmar con cuánto se está cerrando el turno',
            'Subir las luces a full una vez que no haya clientes',
            'Cerrar puertas',
            'Limpiar las mesas sucias',
            'Levantar sillas',
            'Limpiar el baño (el piso se limpia con trapo después de barrerlo)',
            'Barrer el salón y el cubículo donde se encuentra la TV',
            'Trapear el piso. Mezclar cloro, primoroso, y desengrasante en el cubo',
            'Botar el agua sucia del cubo en el lavabo del trapeador de cocina',
            'Enjuagar el trapeador en el cubo con agua caliente de 3 a 5 veces y botar el agua al finalizar',
            'Botar la bolsa de basura del salón y del baño. PONER NUEVAS',
            'Dejar todos los trapos sucios en la cubeta de agua y cloro',
            'Dejar el aire en OFF y apagar todas las luces (5 en total)',
            ['Lavar ambas fuentes de la máquina de refrescos', '4,7']
        ]
    },
    {
        listType: 'LIMPIEZA',
        name: 'Lunes — Cristal',
        dayOfWeek: 1,
        sortOrder: 0,
        tasks: [
            'Limpiar las bolas de cristal de la barra por dentro y por fuera con filtros de café',
            'Limpiar las bolas de cristal de la pared y encima de la mesa 4 con filtros de café',
            'Limpiar los estantes de vidrio de las luces de navidad'
        ]
    },
    {
        listType: 'LIMPIEZA',
        name: 'Martes — Madera',
        dayOfWeek: 2,
        sortOrder: 1,
        tasks: [
            'Limpiar las puertas de entrada y del baño con pulidor de madera',
            'Limpiar las sillas y marcos de madera con pulidor de madera',
            'Limpiar los muebles de madera de la barra donde se ponen los vasos y copas, debajo de la cafetera',
            'Limpiar los muebles de madera encima de la barra del lavatorio',
            'Pulir las botellas de colores'
        ]
    },
    {
        listType: 'LIMPIEZA',
        name: 'Miércoles — Ventanas y nevera',
        dayOfWeek: 3,
        sortOrder: 2,
        tasks: [
            'Limpiar la nevera del salón por dentro y por fuera',
            'Limpiar las ventanas por dentro y por fuera',
            'Limpiar la puerta de vidrio, las ventanas de la entrada y la TV'
        ]
    },
    {
        listType: 'LIMPIEZA',
        name: 'Jueves — Piso y organización',
        dayOfWeek: 4,
        sortOrder: 3,
        tasks: [
            'Organizar los insumos dentro de las puertas debajo de la barra',
            'Revisar 2 pares de puertas de madera y las puertas blancas debajo del lavatorio. Anotar si falta Primoroso, Desengrasante Naranja, Cloro o Vinagre Blanco',
            'Limpiar con cloro el mat de jebe plomo en las ranuras con cuchillo',
            'Limpiar las esquinas del piso con desengrasante'
        ]
    }
];

async function main() {
    const existing = await prisma.shiftSection.count();
    if (existing > 0) {
        console.log(`ShiftSection already has ${existing} row(s) — nothing seeded.`);
        return;
    }

    let sectionCount = 0;
    let taskCount = 0;

    for (const section of SECTIONS) {
        await prisma.shiftSection.create({
            data: {
                listType: section.listType,
                name: section.name,
                dayOfWeek: section.dayOfWeek,
                sortOrder: section.sortOrder,
                tasks: {
                    create: section.tasks.map((task, index) => {
                        const [text, daysOfWeek] = Array.isArray(task) ? task : [task, null];
                        return { text, daysOfWeek, sortOrder: index };
                    })
                }
            }
        });
        sectionCount++;
        taskCount += section.tasks.length;
    }

    console.log(`Seeded ${sectionCount} sections and ${taskCount} tasks.`);
}

main()
    .catch(e => {
        console.error(e);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
