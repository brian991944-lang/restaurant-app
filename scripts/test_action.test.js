const { getDigitalRecipes } = require('./src/app/actions/recetario');

(async () => {
    try {
        const res = await getDigitalRecipes();
        console.log("Result:", JSON.stringify(res, null, 2));
    } catch (e) {
        console.error("Error:", e);
    }
})();
