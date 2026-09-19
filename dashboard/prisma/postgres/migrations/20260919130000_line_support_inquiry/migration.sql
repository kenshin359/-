-- CreateTable
CREATE TABLE "InquiryCategory" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "level" INTEGER NOT NULL DEFAULT 2,
    "mode" TEXT NOT NULL DEFAULT 'APPROVAL',
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "InquiryCategory_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "Inquiry" (
    "id" TEXT NOT NULL,
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
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "firstResponseAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Inquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiDecisionLog" (
    "id" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiDecisionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Correction" (
    "id" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "before" TEXT,
    "after" TEXT,
    "reason" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Correction_pkey" PRIMARY KEY ("id")
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

