/**
 * GET /api/compras/ingredientes — the active RAW ingredients a purchase can be
 * received against, for agents filing supplier receipts.
 *
 * Auth: `Authorization: Bearer $PURCHASE_API_TOKEN`.
 *
 * For packed items (isPacked) a posted qty always means packs; packSize says
 * what one pack is ("50 lb", "425 g"). Weight travels only in totalWeightLb.
 */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { packSize, unitLabel } from "@/lib/purchaseUnits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel Hobby ceiling

export async function GET(req: NextRequest) {
  const token = process.env.PURCHASE_API_TOKEN;
  if (!token || req.headers.get("authorization") !== `Bearer ${token}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const rows = await prisma.ingredient.findMany({
    where: { type: "RAW", isActive: true },
    select: {
      id: true, name: true, metric: true, isPacked: true, unitsPerPack: true, packUnit: true,
      provider: { select: { name: true } },
    },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(
    rows.map(r => ({
      id: r.id,
      name: r.name,
      unitLabel: unitLabel(r.metric),
      isPacked: r.isPacked,
      packUnit: r.isPacked ? r.packUnit : null,
      unitsPerPack: r.isPacked ? r.unitsPerPack : null,
      packSize: packSize(r),
      provider: r.provider?.name ?? null,
    })),
  );
}
