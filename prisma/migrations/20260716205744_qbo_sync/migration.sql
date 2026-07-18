-- CreateTable
CREATE TABLE "QboConnection" (
    "id" TEXT NOT NULL,
    "realmId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "accessTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "refreshTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QboConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QboAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fullyQualifiedName" TEXT,
    "accountType" TEXT,
    "accountSubType" TEXT,
    "classification" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QboAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QboVendor" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QboVendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QboTransactionLine" (
    "id" TEXT NOT NULL,
    "txnId" TEXT NOT NULL,
    "txnType" TEXT NOT NULL,
    "txnDate" DATE NOT NULL,
    "docNumber" TEXT,
    "accountId" TEXT,
    "accountName" TEXT,
    "accountType" TEXT,
    "classification" TEXT,
    "entityName" TEXT,
    "memo" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "postingType" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QboTransactionLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QboSyncState" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "lastCdcAt" TIMESTAMP(3),
    "fullSyncDoneAt" TIMESTAMP(3),
    "lastRunStatus" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QboSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QboConnection_realmId_key" ON "QboConnection"("realmId");

-- CreateIndex
CREATE INDEX "QboTransactionLine_txnDate_idx" ON "QboTransactionLine"("txnDate");

-- CreateIndex
CREATE INDEX "QboTransactionLine_accountName_idx" ON "QboTransactionLine"("accountName");

-- CreateIndex
CREATE INDEX "QboTransactionLine_entityName_idx" ON "QboTransactionLine"("entityName");

-- CreateIndex
CREATE INDEX "QboTransactionLine_txnType_idx" ON "QboTransactionLine"("txnType");

