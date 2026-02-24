
async function run() {
    try {
        const ordersRes = await fetch("https://api.clover.com/v3/merchants/5EFY7JF0XERB1/orders?expand=lineItems&limit=2", {
            headers: {
                "Authorization": "Bearer 80bb90a1-8598-71bb-606d-2d8eac4fe14e",
                "Content-Type": "application/json"
            }
        });
        const ordersData = await ordersRes.json();
        console.log("Orders:", JSON.stringify(ordersData, null, 2));

        const itemsRes = await fetch("https://api.clover.com/v3/merchants/5EFY7JF0XERB1/items?limit=2", {
            headers: {
                "Authorization": "Bearer 80bb90a1-8598-71bb-606d-2d8eac4fe14e",
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
