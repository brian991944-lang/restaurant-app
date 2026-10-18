/**
 * POST /api/compras/recibir — receive a supplier purchase into raw stock.
 *
 * Auth: `Authorization: Bearer $PURCHASE_API_TOKEN`.
 * Body: same as registerPurchase; source defaults to "API". Each line may name
 * its ingredient by exact `name` instead of `ingredientId`.
 *   destination: "RESTAURANT" (default, credits kitchen stock) | "HOME"
 *                (goes to Almacén → Casa de Brian; nothing enters kitchen stock)
 *   400 → bad body, or { unknownNames } when a name doesn't match (nothing written)
 *   409 → externalRef already received, { receiptId } of the existing one
 */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { registerPurchase, type PurchaseDestination, type PurchaseLineInput, type PurchaseSource } from "@/app/actions/purchases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel Hobby ceiling

type RawLine = Partial<PurchaseLineInput> & { name?: string };

export async function POST(req: NextRequest) {
  const token = process.env.PURCHASE_API_TOKEN;
  if (!token || req.headers.get("authorization") !== `Bearer ${token}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "JSON inválido." }, { status: 400 }); }
  if (!body || !Array.isArray(body.lines) || body.lines.length === 0) {
    return NextResponse.json({ ok: false, error: "Faltan las líneas de la compra." }, { status: 400 });
  }
  const destination = String(body.destination ?? "RESTAURANT").toUpperCase() as PurchaseDestination;
  if (destination !== "RESTAURANT" && destination !== "HOME") {
    return NextResponse.json({ ok: false, error: "destination debe ser RESTAURANT o HOME." }, { status: 400 });
  }

  const raw: RawLine[] = body.lines;
  const names = [...new Set(raw.filter(l => !l.ingredientId && l.name).map(l => String(l.name)))];
  const found = names.length
    ? await prisma.ingredient.findMany({ where: { name: { in: names } }, select: { id: true, name: true } })
    : [];
  const idByName = new Map(found.map(i => [i.name, i.id]));
  const unknownNames = names.filter(n => !idByName.has(n));
  if (unknownNames.length) {
    return NextResponse.json({ ok: false, error: "Ingredientes desconocidos.", unknownNames }, { status: 400 });
  }
  if (raw.some(l => !l.ingredientId && !l.name)) {
    return NextResponse.json({ ok: false, error: "Cada línea necesita ingredientId o name." }, { status: 400 });
  }

  const lines: PurchaseLineInput[] = raw.map(l => ({
    ingredientId: l.ingredientId || idByName.get(String(l.name))!,
    qty: Number(l.qty),
    unit: String(l.unit ?? ""),
    totalWeightLb: l.totalWeightLb == null ? null : Number(l.totalWeightLb),
    priceCents: l.priceCents == null ? null : Math.round(Number(l.priceCents)),
    // Optional: each ball's weight (lb) for cleaning-mode meats, e.g. [12.92, 12.36, …].
    pieceWeightsLb: Array.isArray(l.pieceWeightsLb) ? l.pieceWeightsLb.map(Number) : null,
  }));

  const result = await registerPurchase({
    providerId: body.providerId ?? null,
    supplierName: body.supplierName ?? null,
    purchasedAt: body.purchasedAt,
    source: (body.source ?? "API") as PurchaseSource,
    destination,
    externalRef: body.externalRef ?? null,
    note: body.note ?? null,
    lines,
  });

  if (result.ok) return NextResponse.json(result);
  if (result.duplicate) return NextResponse.json(result, { status: 409 });
  return NextResponse.json(result, { status: 400 });
}
