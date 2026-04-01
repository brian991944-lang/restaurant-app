const { editIngredient } = require('./src/app/actions/inventory.ts');

async function testAction() {
    // Requires transpile, let's use Prisma directly to see if UI variables were corrupt.
    // Wait, let's check what `isPacked` does to `initialQty`:
    // initialQty: formData.get('initialQty') !== '' && formData.get('initialQty') !== null ? (parseFloat(formData.get('initialQty') as string) * (isPacked ? unitsPerPack : 1)) : undefined,
    let isPacked = false;
    let unitsPerPack = 1;

    let formData_get_initialQty = "0"; // User left the input as 0!

    let initialQty = formData_get_initialQty !== '' && formData_get_initialQty !== null ? (parseFloat(formData_get_initialQty) * (isPacked ? unitsPerPack : 1)) : undefined;

    console.log("Passed initialQty:", initialQty);
}
testAction();
