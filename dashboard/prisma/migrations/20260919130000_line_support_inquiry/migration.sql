-- CreateTable
CREATE TABLE "InquiryCategory" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "level" INTEGER NOT NULL DEFAULT 2,
    "mode" TEXT NOT NULL DEFAULT 'APPROVAL',
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "Inquiry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "lineUserId" TEXT NOT NULL,
    "caseNo" INTEGER,
    "userText" TEXT NOT NULL,
    "categoryCode" TEXT,
    "level" INTEGER,
    "confidence" INTEGER,
    "mode" TEXT,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "draft" TEXT,
    "sentText" TEXT,
    "sentBy" TEXT,
    "kbRefs" TEXT,
    "reason" TEXT,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstResponseAt" DATETIME,
    "resolvedAt" DATETIME
);

-- CreateTable
CREATE TABLE "AiDecisionLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "refId" TEXT,
    "model" TEXT,
    "inputSummary" TEXT,
    "outputJson" TEXT,
    "confidence" INTEGER,
    "reason" TEXT,
    "latencyMs" INTEGER,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Correction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "before" TEXT,
    "after" TEXT,
    "reason" TEXT,
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "Inquiry_status_receivedAt_idx" ON "Inquiry"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "Inquiry_caseNo_idx" ON "Inquiry"("caseNo");

-- CreateIndex
CREATE INDEX "Inquiry_lineUserId_receivedAt_idx" ON "Inquiry"("lineUserId", "receivedAt");

-- CreateIndex
CREATE INDEX "AiDecisionLog_kind_createdAt_idx" ON "AiDecisionLog"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "Correction_targetType_createdAt_idx" ON "Correction"("targetType", "createdAt");
