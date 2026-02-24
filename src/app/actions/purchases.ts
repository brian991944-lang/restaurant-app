'use server';

import prisma from '@/lib/prisma';

export async function getVendorItems() {
    return prisma.vendorMarketItem.findMany({
        include: {
            ingredient: true
        }
    });
}

export async function processInvoiceImage(fileData: string) {
    // This is a mocked AI processing function per the requirements
    // It mocks "extracting data", Entity Resolution & Mapping
    // In a real app, we would send the file to an OpenAI/Gemini API here

    // Simulate network delay
    await new Promise(r => setTimeout(r, 2000));

    // Mock Response from AI
    return [
        {
            extractedDesc: "CHICKEN BRST BL/SL JUMBO",
            vendorName: "Sysco",
            packSize: 40,
            packUnit: "lb",
            currentPackPrice: 85.00,
            confidence: 95,
            mappedIngredientName: "Chicken Breast" // Suppose it successfully mapped
        },
        {
            extractedDesc: "ONION SPANISH JUMBO 50#",
            vendorName: "Sysco",
            packSize: 50,
            packUnit: "lb",
            currentPackPrice: 20.00,
            confidence: 90,
            mappedIngredientName: "Red Onion"
        },
        {
            extractedDesc: "MYSTERY SAUCE GALS",
            vendorName: "Sysco",
            packSize: 4,
            packUnit: "gal",
            currentPackPrice: 45.00,
            confidence: 40,
            mappedIngredientName: null // Needs human review
        }
    ];
}

export async function saveVendorItem(data: any) {
    try {
        const vendorItem = await prisma.vendorMarketItem.create({
            data: {
                ingredientId: data.ingredientId,
                vendorName: data.vendorName || "Unknown Vendor",
                invoiceDescription: data.invoiceDescription,
                packSize: parseFloat(data.packSize),
                packUnit: data.packUnit,
                currentPackPrice: parseFloat(data.currentPackPrice),
                lastPurchasedDate: new Date(),
                culinaryNotes: data.culinaryNotes || null,
                isPreferredVendor: data.isPreferredVendor || false
            }
        });

        // Also update the parent's current Price if this is the preferred vendor or if forced active
        if (data.forceActiveLink) {
            const normalizedPrice = parseFloat(data.currentPackPrice) / parseFloat(data.packSize);
            // Updating the Master Ingredient Price 
            await prisma.ingredient.update({
                where: { id: data.ingredientId },
                data: {
                    currentPrice: normalizedPrice,
                    activeMarketItemId: vendorItem.id
                }
            });
        }

        return { success: true, vendorItem };
    } catch (e) {
        console.error('Failed to save vendor item:', e);
        return { success: false, error: 'Database Error' };
    }
}
