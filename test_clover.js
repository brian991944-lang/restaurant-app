
const CLOVER_MERCHANT_ID = process.env.CLOVER_MERCHANT_ID;
const CLOVER_API_TOKEN = process.env.CLOVER_API_TOKEN;

if (!CLOVER_MERCHANT_ID || !CLOVER_API_TOKEN) {
    console.error('Faltan las credenciales de Clover (CLOVER_MERCHANT_ID / CLOVER_API_TOKEN) en las variables de entorno');
    console.error('Ejecuta con: node --env-file=.env test_clover.js');
    process.exit(1);
}

async function run() {
    try {
        const ordersRes = await fetch(`https://api.clover.com/v3/merchants/${CLOVER_MERCHANT_ID}/orders?expand=lineItems&limit=2`, {
            headers: {
                "Authorization": `Bearer ${CLOVER_API_TOKEN}`,
                "Content-Type": "application/json"
            }
        });
        const ordersData = await ordersRes.json();
        console.log("Orders:", JSON.stringify(ordersData, null, 2));

        const itemsRes = await fetch(`https://api.clover.com/v3/merchants/${CLOVER_MERCHANT_ID}/items?limit=2`, {
            headers: {
                "Authorization": `Bearer ${CLOVER_API_TOKEN}`,
                "Content-Type": "application/json"
            }
        });
        const itemsData = await itemsRes.json();
        console.log("Items:", JSON.stringify(itemsData, null, 2));
    } catch (e) {
        console.error(e);
    }
}
run();
