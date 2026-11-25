-- Gift cards — confirmation fields added 2026-11-25 (what `prisma db push` would add).
-- A card is confirmed once the issuing server has signed and the Toast check # is recorded.
ALTER TABLE "GiftCard" ADD COLUMN IF NOT EXISTS "firmaPath" TEXT;
ALTER TABLE "GiftCard" ADD COLUMN IF NOT EXISTS "firmaBox" TEXT;
ALTER TABLE "GiftCard" ADD COLUMN IF NOT EXISTS "confirmedAt" TIMESTAMP(3);
ALTER TABLE "GiftCard" ADD COLUMN IF NOT EXISTS "confirmedByName" TEXT;
