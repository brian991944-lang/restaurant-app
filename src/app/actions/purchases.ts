'use server';

import prisma from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { Prisma } from '@prisma/client';
import { computeCredit, unitLabel } from '@/lib/purchaseUnits';

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

// ─── Recibir compra ─────────────────────────────────────────────────────────
// A purchase posts to raw stock. PurchaseLine keeps what was bought (qty +
// unit exactly as sent); the PURCHASE InventoryTransaction keeps what was
// credited, in the ingredient's metric. Credits go to frozenQty only.

export type PurchaseSource = 'MANUAL' | 'MUSE' | 'API';

export interface PurchaseLineInput {
    ingredientId: string;
    qty: number;
    unit: string;
    totalWeightLb?: number | null;
    priceCents?: number | null;
}

export interface PurchaseInput {
    providerId?: string | null;
    supplierName?: string | null;
    purchasedAt: string; // ISO
    source: PurchaseSource;
    externalRef?: string | null;
    note?: string | null;
    lines: PurchaseLineInput[];
}

export interface CreditedLine {
    ingredientId: string;
    name: string;
    credited: number;
    unitLabel: string;
    newStock: number;
}

export type PurchaseResult =
    | { ok: true; receiptId: string; lines: CreditedLine[] }
    | { ok: false; duplicate: true; receiptId: string }
    | { ok: false; duplicate?: false; error: string };

const SOURCES: PurchaseSource[] = ['MANUAL', 'MUSE', 'API'];

export async function registerPurchase(input: PurchaseInput): Promise<PurchaseResult> {
    try {
        const purchasedAt = new Date(input.purchasedAt);
        if (isNaN(purchasedAt.getTime())) return { ok: false, error: 'Fecha de compra inválida.' };
        if (!SOURCES.includes(input.source)) return { ok: false, error: `Origen inválido: ${input.source}.` };
        if (!Array.isArray(input.lines) || input.lines.length === 0) return { ok: false, error: 'La compra no tiene artículos.' };

        const externalRef = input.externalRef?.trim() || null;
        if (externalRef) {
            const existing = await prisma.purchaseReceipt.findUnique({ where: { externalRef }, select: { id: true } });
            if (existing) return { ok: false, duplicate: true, receiptId: existing.id };
        }

        const ids = [...new Set(input.lines.map(l => l.ingredientId))];
        const ingredients = await prisma.ingredient.findMany({
            where: { id: { in: ids } },
            select: { id: true, name: true, type: true, metric: true, isPacked: true, unitsPerPack: true, packUnit: true },
        });
        const byId = new Map(ingredients.map(i => [i.id, i]));

        // Validate every line and work out its credit before anything is written.
        const errors: string[] = [];
        const planned = input.lines.map(line => {
            const ing = byId.get(line.ingredientId);
            if (!ing) { errors.push(`Ingrediente no encontrado: ${line.ingredientId}.`); return null; }
            if (ing.type !== 'RAW') { errors.push(`${ing.name} no es un ingrediente crudo (RAW).`); return null; }
            if (!(typeof line.qty === 'number' && isFinite(line.qty) && line.qty > 0)) {
                errors.push(`${ing.name}: la cantidad debe ser mayor que 0.`); return null;
            }
            const credit = computeCredit(ing, line);
            if (!credit.ok) { errors.push(credit.error); return null; }
            return { line, ing, credited: credit.credited };
        });
        if (errors.length) return { ok: false, error: errors.join(' ') };

        let supplierName = input.supplierName?.trim() || null;
        if (!supplierName && input.providerId) {
            const provider = await prisma.provider.findUnique({ where: { id: input.providerId }, select: { name: true } });
            supplierName = provider?.name ?? null;
        }

        const result = await prisma.$transaction(async tx => {
            const receipt = await tx.purchaseReceipt.create({
                data: {
                    providerId: input.providerId || null,
                    supplierName,
                    purchasedAt,
                    source: input.source,
                    externalRef,
                    note: input.note?.trim() || null,
                    lines: {
                        create: input.lines.map(l => ({
                            ingredientId: l.ingredientId,
                            qty: l.qty,
                            unit: l.unit ?? '',
                            totalWeightLb: l.totalWeightLb ?? null,
                            priceCents: l.priceCents ?? null,
                        })),
                    },
                },
            });

            const lines: CreditedLine[] = [];
            for (const p of planned) {
                const { line, ing, credited } = p!;
                const inv = await tx.inventory.upsert({
                    where: { ingredientId: ing.id },
                    create: { ingredientId: ing.id, frozenQty: credited, thawingQty: 0 },
                    update: { frozenQty: { increment: credited } },
                });
                await tx.inventoryTransaction.create({
                    data: {
                        ingredientId: ing.id,
                        type: 'PURCHASE',
                        qty: credited,
                        note: `Compra ${supplierName ?? 'sin proveedor'}: ${line.qty} ${line.unit ?? ''}`.trim(),
                    },
                });
                lines.push({
                    ingredientId: ing.id,
                    name: ing.name,
                    credited,
                    unitLabel: unitLabel(ing.metric),
                    newStock: inv.frozenQty + inv.thawingQty,
                });
            }
            return { receiptId: receipt.id, lines };
        }, { maxWait: 10000, timeout: 30000 });

        revalidatePath('/[locale]/compras', 'page');
        revalidatePath('/[locale]/inventory', 'page');
        return { ok: true, ...result };
    } catch (e: any) {
        // Two posts of the same receipt racing past the pre-check above.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && input.externalRef) {
            const existing = await prisma.purchaseReceipt.findUnique({ where: { externalRef: input.externalRef.trim() }, select: { id: true } });
            if (existing) return { ok: false, duplicate: true, receiptId: existing.id };
        }
        console.error('Error registering purchase:', e);
        return { ok: false, error: e.message };
    }
}

/** Average lb per unit bought over the last 5 lines that carried a total weight. */
export async function getRecentPurchaseWeights(ingredientId: string) {
    try {
        const recent = await prisma.purchaseLine.findMany({
            where: { ingredientId, totalWeightLb: { not: null }, qty: { gt: 0 } },
            orderBy: { createdAt: 'desc' },
            take: 5,
            select: { qty: true, totalWeightLb: true },
        });
        if (recent.length === 0) return { success: true, avgLbPerUnit: null, samples: 0 };
        const avg = recent.reduce((s, l) => s + (l.totalWeightLb as number) / l.qty, 0) / recent.length;
        return { success: true, avgLbPerUnit: avg, samples: recent.length };
    } catch (e: any) {
        console.error('Error reading recent purchase weights:', e);
        return { success: false, error: e.message };
    }
}

/** Everything the Recibir tab needs: active RAW (COMPRADO ones prefill), providers. */
export async function getRecibirData() {
    try {
        const [ingredients, providers] = await Promise.all([
            prisma.ingredient.findMany({
                where: { type: 'RAW', isActive: true },
                select: {
                    id: true, name: true, metric: true, isPacked: true, unitsPerPack: true, packUnit: true,
                    purchaseStatus: true, providerId: true,
                    provider: { select: { name: true } },
                    inventory: { select: { frozenQty: true, thawingQty: true } },
                },
                orderBy: { name: 'asc' },
            }),
            prisma.provider.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
        ]);
        return { success: true, ingredients, providers };
    } catch (e: any) {
        console.error('Error loading recibir data:', e);
        return { success: false, error: e.message, ingredients: [], providers: [] };
    }
}

/**
 * Received items leave the shopping list: the same clean reset Finalizar
 * Compras gives a COMPRADO item, applied only to the ingredients just received.
 */
export async function markReceived(ingredientIds: string[]) {
    try {
        await prisma.ingredient.updateMany({
            where: { id: { in: ingredientIds }, purchaseStatus: 'COMPRADO' },
            data: { purchaseStatus: 'PENDIENTE', needsOrdering: false, isSubmittedForOrdering: false, carriedOver: false },
        });
        revalidatePath('/[locale]/compras', 'page');
        return { success: true };
    } catch (e: any) {
        console.error('Error marking received:', e);
        return { success: false, error: e.message };
    }
}

/** COMPRADO items in these providers with no purchase line since `sinceIso` (local midnight). */
export async function countUnreceivedComprado(providerNames: string[], sinceIso: string) {
    try {
        const count = await prisma.ingredient.count({
            where: {
                purchaseStatus: 'COMPRADO',
                provider: { name: { in: providerNames } },
                purchaseLines: { none: { createdAt: { gte: new Date(sinceIso) } } },
            },
        });
        return { success: true, count };
    } catch (e: any) {
        console.error('Error counting unreceived items:', e);
        return { success: false, error: e.message, count: 0 };
    }
}
