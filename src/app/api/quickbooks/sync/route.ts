// Vercel Cron hits this daily (GET). First run = full backfill;
// subsequent runs use QBO Change Data Capture (CDC).
//
// vercel.json:
//   { "crons": [{ "path": "/api/quickbooks/sync", "schedule": "0 10 * * *" }] }
//   (10:00 UTC ≈ 6 AM ET — after the app's 5 AM business-day cutover)
//
// Auth mirrors /api/cron: Bearer CRON_SECRET or the vercel-cron user agent.
//
// NOTE: CDC only looks back 30 days. If the cron is down longer than
// that, delete QboSyncState to force a full re-backfill.

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { qboGet, qboQueryAll, getValidConnection } from "@/lib/quickbooks/client";

export const maxDuration = 300;

const TXN_ENTITIES = ["Purchase", "Bill", "Invoice", "JournalEntry"] as const;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const isVercelCron = req.headers.get("user-agent")?.startsWith("vercel-cron");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && !isVercelCron) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!(await getValidConnection())) {
    return NextResponse.json({ error: "QuickBooks not connected" }, { status: 409 });
  }

  const startedAt = new Date();
  try {
    const state = await prisma.qboSyncState.findUnique({ where: { id: "singleton" } });

    // Dimensions first (cheap, keeps denormalized fields fresh)
    await syncAccounts();
    await syncVendors();

    let mode: "full" | "cdc";
    if (!state?.fullSyncDoneAt) {
      mode = "full";
      for (const entity of TXN_ENTITIES) {
        const rows = await qboQueryAll(entity);
        await upsertTransactionRows(entity, rows);
      }
    } else {
      mode = "cdc";
      const since = state.lastCdcAt ?? new Date(Date.now() - 29 * 24 * 3600 * 1000);
      const data = await qboGet("/cdc", {
        entities: TXN_ENTITIES.join(","),
        changedSince: since.toISOString(),
      });
      const responses: any[] = data?.CDCResponse?.[0]?.QueryResponse ?? [];
      for (const qr of responses) {
        for (const entity of TXN_ENTITIES) {
          if (qr[entity]) await upsertTransactionRows(entity, qr[entity]);
        }
      }
    }

    await prisma.qboSyncState.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", lastCdcAt: startedAt, fullSyncDoneAt: startedAt, lastRunStatus: `ok (${mode})` },
      update: {
        lastCdcAt: startedAt,
        fullSyncDoneAt: state?.fullSyncDoneAt ?? startedAt,
        lastRunStatus: `ok (${mode})`,
      },
    });
    return NextResponse.json({ ok: true, mode });
  } catch (err: any) {
    console.error("QBO sync failed:", err);
    await prisma.qboSyncState.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", lastRunStatus: `error: ${err.message}` },
      update: { lastRunStatus: `error: ${err.message}` },
    });
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

async function syncAccounts() {
  const accounts = await qboQueryAll("Account");
  for (const a of accounts) {
    await prisma.qboAccount.upsert({
      where: { id: a.Id },
      create: {
        id: a.Id,
        name: a.Name,
        fullyQualifiedName: a.FullyQualifiedName ?? null,
        accountType: a.AccountType ?? null,
        accountSubType: a.AccountSubType ?? null,
        classification: a.Classification ?? null,
        active: a.Active ?? true,
      },
      update: {
        name: a.Name,
        fullyQualifiedName: a.FullyQualifiedName ?? null,
        accountType: a.AccountType ?? null,
        accountSubType: a.AccountSubType ?? null,
        classification: a.Classification ?? null,
        active: a.Active ?? true,
      },
    });
  }
}

async function syncVendors() {
  const vendors = await qboQueryAll("Vendor");
  for (const v of vendors) {
    await prisma.qboVendor.upsert({
      where: { id: v.Id },
      create: { id: v.Id, displayName: v.DisplayName, active: v.Active ?? true },
      update: { displayName: v.DisplayName, active: v.Active ?? true },
    });
  }
}

/** Flatten QBO transactions into QboTransactionLine rows. */
async function upsertTransactionRows(txnType: string, rows: any[]) {
  // Account lookup for denormalizing type/classification
  const accounts = await prisma.qboAccount.findMany();
  const accById = new Map(accounts.map((a) => [a.id, a]));

  for (const txn of rows) {
    // CDC returns { Id, status: "Deleted" } for deleted transactions
    if (txn.status === "Deleted") {
      await prisma.qboTransactionLine.deleteMany({
        where: { txnType, txnId: txn.Id },
      });
      continue;
    }

    // Replace all lines for this txn (handles edited/removed lines)
    await prisma.qboTransactionLine.deleteMany({ where: { txnType, txnId: txn.Id } });

    const txnDate = new Date(txn.TxnDate);
    const entityName =
      txn.EntityRef?.name ?? txn.VendorRef?.name ?? txn.CustomerRef?.name ?? null;

    const lines: any[] = txn.Line ?? [];
    let idx = 0;
    const toCreate: any[] = [];

    for (const line of lines) {
      let accountId: string | null = null;
      let amount: number | null = null;
      let postingType: string | null = null;
      let lineEntity: string | null = null;

      if (line.DetailType === "AccountBasedExpenseLineDetail") {
        accountId = line.AccountBasedExpenseLineDetail?.AccountRef?.value ?? null;
        amount = line.Amount ?? 0;
      } else if (line.DetailType === "ItemBasedExpenseLineDetail") {
        // Item-based purchase lines: no direct account ref on the line.
        // Record under the item name so the spend is still visible.
        amount = line.Amount ?? 0;
      } else if (line.DetailType === "JournalEntryLineDetail") {
        const d = line.JournalEntryLineDetail;
        accountId = d?.AccountRef?.value ?? null;
        postingType = d?.PostingType ?? null;
        amount = (line.Amount ?? 0) * (postingType === "Credit" ? -1 : 1);
        lineEntity = d?.Entity?.EntityRef?.name ?? null;
      } else if (line.DetailType === "SalesItemLineDetail") {
        amount = line.Amount ?? 0;
      } else {
        continue; // subtotals, tax lines, etc.
      }

      const acc = accountId ? accById.get(accountId) : undefined;
      toCreate.push({
        id: `${txnType}:${txn.Id}:${idx++}`,
        txnId: txn.Id,
        txnType,
        txnDate,
        docNumber: txn.DocNumber ?? null,
        accountId: accountId,
        accountName:
          acc?.name ??
          line.SalesItemLineDetail?.ItemRef?.name ??
          line.ItemBasedExpenseLineDetail?.ItemRef?.name ??
          null,
        accountType: acc?.accountType ?? null,
        classification: acc?.classification ?? (txnType === "Invoice" ? "Revenue" : null),
        entityName: lineEntity ?? entityName,
        memo: line.Description ?? txn.PrivateNote ?? null,
        amount: amount ?? 0,
        postingType,
      });
    }

    if (toCreate.length) {
      await prisma.qboTransactionLine.createMany({ data: toCreate });
    }
  }
}
