-- Gift cards — what `prisma db push` creates for the GiftCard models added on
-- 2026-11-25. Kept here because the schema was applied through the Supabase
-- connector rather than from a machine that could reach the database.
-- Safe to re-run: every statement is IF NOT EXISTS.

DO $$ BEGIN
  CREATE TYPE "GiftCardStatus" AS ENUM ('ACTIVA', 'AGOTADA', 'ANULADA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "GiftCardEmailStatus" AS ENUM ('PENDIENTE_ENVIO', 'ENVIADO', 'ERROR');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "GiftCard" (
  "id"             TEXT NOT NULL,
  "code"           TEXT NOT NULL,
  "amountCents"    INTEGER NOT NULL,
  "balanceCents"   INTEGER NOT NULL,
  "toNames"        TEXT,
  "fromNames"      TEXT,
  "recipientEmail" TEXT NOT NULL,
  "purchaserEmail" TEXT,
  "occasion"       TEXT,
  "message"        TEXT,
  "toastCheck"     TEXT,
  "issuedByName"   TEXT,
  "issuedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"      TIMESTAMP(3) NOT NULL,
  "status"         "GiftCardStatus" NOT NULL DEFAULT 'ACTIVA',
  "emailStatus"    "GiftCardEmailStatus" NOT NULL DEFAULT 'PENDIENTE_ENVIO',
  "emailSentAt"    TIMESTAMP(3),
  "emailError"     TEXT,
  "anuladaAt"      TIMESTAMP(3),
  "anuladaMotivo"  TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GiftCard_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "GiftCard_code_key" ON "GiftCard"("code");
CREATE INDEX IF NOT EXISTS "GiftCard_status_idx" ON "GiftCard"("status");
CREATE INDEX IF NOT EXISTS "GiftCard_issuedAt_idx" ON "GiftCard"("issuedAt");

CREATE TABLE IF NOT EXISTS "GiftCardRedemption" (
  "id"          TEXT NOT NULL,
  "giftCardId"  TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "toastCheck"  TEXT,
  "note"        TEXT,
  "byName"      TEXT,
  "at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GiftCardRedemption_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "GiftCardRedemption_giftCardId_idx" ON "GiftCardRedemption"("giftCardId");

DO $$ BEGIN
  ALTER TABLE "GiftCardRedemption"
    ADD CONSTRAINT "GiftCardRedemption_giftCardId_fkey"
    FOREIGN KEY ("giftCardId") REFERENCES "GiftCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
