// POST { rows, cols, measure, from, to, txnTypes?, classifications? }
//   rows/cols ∈ "account" | "vendor" | "month" | "txnType" | "classification"
//   measure   ∈ "sum" | "count"
// Returns a pivot matrix: { connected, rowKeys, colKeys, cells, rowTotals, colTotals, grandTotal }
//
// Dimensions are mapped through a hard whitelist → no SQL injection surface.
// Admin-guarded via the fusionista_admin cookie (see src/lib/adminGuard.ts).

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isAdminRequest } from "@/lib/adminGuard";

const DIMENSIONS: Record<string, Prisma.Sql> = {
  account: Prisma.sql`COALESCE("accountName", '(sin cuenta)')`,
  vendor: Prisma.sql`COALESCE("entityName", '(sin proveedor/cliente)')`,
  month: Prisma.sql`to_char("txnDate", 'YYYY-MM')`,
  txnType: Prisma.sql`"txnType"`,
  classification: Prisma.sql`COALESCE("classification", '(sin clasificar)')`,
};

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Lightweight status check for the UI
  const conn = await prisma.qboConnection.findFirst();
  const state = await prisma.qboSyncState.findUnique({ where: { id: "singleton" } });
  return NextResponse.json({
    connected: !!conn,
    lastSync: state?.lastCdcAt ?? null,
    lastRunStatus: state?.lastRunStatus ?? null,
  });
}

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const rowDim = DIMENSIONS[body.rows];
  const colDim = DIMENSIONS[body.cols];
  const measure = body.measure === "count" ? "count" : "sum";

  if (!rowDim || !colDim || body.rows === body.cols) {
    return NextResponse.json({ error: "invalid dimensions" }, { status: 400 });
  }

  const conn = await prisma.qboConnection.findFirst();
  if (!conn) return NextResponse.json({ connected: false, cells: [] });

  const filters: Prisma.Sql[] = [];
  if (body.from) filters.push(Prisma.sql`"txnDate" >= ${new Date(body.from)}`);
  if (body.to) filters.push(Prisma.sql`"txnDate" <= ${new Date(body.to)}`);
  if (Array.isArray(body.txnTypes) && body.txnTypes.length)
    filters.push(Prisma.sql`"txnType" IN (${Prisma.join(body.txnTypes)})`);
  if (Array.isArray(body.classifications) && body.classifications.length)
    filters.push(Prisma.sql`"classification" IN (${Prisma.join(body.classifications)})`);

  const where = filters.length
    ? Prisma.sql`WHERE ${Prisma.join(filters, " AND ")}`
    : Prisma.empty;

  const agg =
    measure === "count" ? Prisma.sql`COUNT(*)::float` : Prisma.sql`SUM("amount")::float`;

  const data = await prisma.$queryRaw<
    { r: string; c: string; v: number }[]
  >(Prisma.sql`
    SELECT ${rowDim} AS r, ${colDim} AS c, ${agg} AS v
    FROM "QboTransactionLine"
    ${where}
    GROUP BY 1, 2
    ORDER BY 1, 2
  `);

  const rowKeys = [...new Set(data.map((d) => d.r))];
  const colKeys = [...new Set(data.map((d) => d.c))].sort();

  const cells: Record<string, Record<string, number>> = {};
  const rowTotals: Record<string, number> = {};
  const colTotals: Record<string, number> = {};
  let grandTotal = 0;

  for (const { r, c, v } of data) {
    (cells[r] ??= {})[c] = v;
    rowTotals[r] = (rowTotals[r] ?? 0) + v;
    colTotals[c] = (colTotals[c] ?? 0) + v;
    grandTotal += v;
  }

  // Sort rows by total, descending — the useful default for spend analysis
  rowKeys.sort((a, b) => (rowTotals[b] ?? 0) - (rowTotals[a] ?? 0));

  return NextResponse.json({
    connected: true,
    rowKeys,
    colKeys,
    cells,
    rowTotals,
    colTotals,
    grandTotal,
  });
}
