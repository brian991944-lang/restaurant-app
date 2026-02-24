'use server';

import prisma from '@/lib/prisma';

/**
 * Calculates a forecasted daily requirement for a specific ingredient
 * based on the historical sales of the dishes it belongs to.
 * 
 * @param ingredientId The ID of the ingredient to forecast
 * @param lookbackDays Number of past days to average over (e.g., 7 for a 1-week moving average)
 * @returns The forecasted daily amount needed (in the ingredient's metric/portions)
 */
export async function calculateIngredientForecast(ingredientId: string, lookbackDays: number = 7): Promise<number> {
    try {
        // 1. Get all recipes that use this specific ingredient
        const recipeLinks = await prisma.recipeIngredient.findMany({
            where: { ingredientId },
            include: {
                menuItem: true // Contains the name (e.g. "Ceviche Clásico")
            }
        });

        if (recipeLinks.length === 0) {
            return 0; // Ingredient is not tied to any sold dishes, forecast is 0
        }

        // 2. Define the exact date bounds for the lookback window
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - lookbackDays);

        let totalForecastAmount = 0;

        // 3. For each dish that uses this ingredient, calculate the average daily sales
        for (const link of recipeLinks) {
            const menuItemName = link.menuItem.name;

            // Note: 'quantity' represents the amount of product used per 1 dish (e.g. 0.15kg of fish)
            const productAmountUsedPerDish = link.quantity;

            // Query sales data for this specific dish within our historical window
            const recentSales = await prisma.dailySales.findMany({
                where: {
                    itemName: menuItemName,
                    date: {
                        gte: startDate,
                        lte: endDate
                    }
                }
            });

            // Calculate the total units of this dish sold in the window
            const totalDishesSold = recentSales.reduce((sum, sale) => sum + sale.qtySOLD, 0);

            // Calculate Average Daily Sales (SMA - Simple Moving Average)
            const averageDailyDishesSold = totalDishesSold / lookbackDays;

            // Forecast = Average Daily Dishes Sold * Amount of Product Used Per Dish
            const forecastedIngredientUsage = averageDailyDishesSold * productAmountUsedPerDish;

            totalForecastAmount += forecastedIngredientUsage;
        }

        // 4. Factor in the Yield Percentage (Rendimiento)
        const ingredient = await prisma.ingredient.findUnique({
            where: { id: ingredientId },
            select: { yieldPercent: true }
        });

        if (ingredient && ingredient.yieldPercent < 100 && ingredient.yieldPercent > 0) {
            // Formula: Required Amount = Forecast Amount / (Yield % / 100)
            const yieldPercentage = (ingredient.yieldPercent / 100);
            totalForecastAmount = totalForecastAmount / yieldPercentage;
        }

        return Number(totalForecastAmount.toFixed(2)); // Return rounded to 2 decimals

    } catch (error) {
        console.error('Failed to calculate forecast for ingredient:', ingredientId, error);
        return 0;
    }
}

/**
 * Convenience function to calculate forecasts for ALL ingredients in the database
 */
export async function calculateAllForecasts(lookbackDays: number = 7) {
    const allIngredients = await prisma.ingredient.findMany({
        select: { id: true, name: true, type: true }
    });

    const forecasts = [];

    for (const ingredient of allIngredients) {
        if (ingredient.type === 'RAW') { // Foreacts usually apply to raw materials pulled for prep
            const forecast = await calculateIngredientForecast(ingredient.id, lookbackDays);
            forecasts.push({
                ingredientId: ingredient.id,
                name: ingredient.name,
                suggestedPrepAmount: forecast
            });
        }
    }

    return forecasts;
}
