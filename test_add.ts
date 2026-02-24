const { addProvider, getProviders } = require('./src/app/actions/inventory.ts');

async function test() {
    console.log(await addProvider('HelloTest'));
}

test();
